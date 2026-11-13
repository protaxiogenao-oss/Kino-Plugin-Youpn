/// <reference path="./kino.d.ts" />
/**
 * YouPorn — Kino plugin v1.0.2
 * Author: Hotaru Yume / hotaruyume
 * Fuente: youporn.com
 * - HLS multi-calidad (ajuste de calidad)
 * - Sin gay / trans / anuncios
 * - Miniaturas: data-src prioritario, sin data: URIs
 * - Home ligero: pocas filas + 12 ítems; el resto en "Ver más"
 * v1.0.2: sin Hentai; filtro ads; mejor poster; menos requests en Home
 */

const BASE = "https://www.youporn.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const GAY_TRANS_RE =
  /\b(gay|lesbian|trans|shemale|ladyboy|futa|futanari|crossdress|sissy|twink|bear|otter|daddy-son|mlm|wlw|ftm|mtf|tgirl|ts-|ts |transsexual|transgender)\b/i;

const AD_RE =
  /\b(sponsored|sponsor|advert|promo code|trafficjunky|exoclick|juicyads|outbrain|taboola|click here|buy now|discount|affiliate)\b/i;

const MAX_PAGE = 48;
const HOME_ROW = 12;

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
    Referer: BASE + "/",
    Cookie: "age_verified=1; platform=pc",
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abs(u) {
  if (!u) return "";
  u = String(u).replace(/&amp;/g, "&").trim();
  if (!u || u.indexOf("data:") === 0) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function makeId(s) {
  return String(s || "x")
    .replace(/[^A-Za-z0-9._~-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

function isBlocked(title, path) {
  var t = (title || "") + " " + (path || "");
  return GAY_TRANS_RE.test(t) || AD_RE.test(t);
}

function extractPoster(block) {
  if (!block) return "";
  var m =
    block.match(/data-src="(https?:\/\/[^"]+)"/i) ||
    block.match(/data-mediumthumb="(https?:\/\/[^"]+)"/i) ||
    block.match(/data-thumb(?:nail)?="(https?:\/\/[^"]+)"/i) ||
    block.match(/data-image="(https?:\/\/[^"]+)"/i);
  if (m) {
    var p = abs(m[1]);
    if (p) return p;
  }
  var ss = block.match(/srcset="([^"]+)"/i);
  if (ss) {
    var parts = ss[1].split(",");
    var best = "";
    var bestW = 0;
    for (var i = 0; i < parts.length; i++) {
      var bit = parts[i].trim().split(/\s+/);
      var url = abs(bit[0]);
      var w = parseInt(bit[1] || "0", 10) || 0;
      if (url && w >= bestW) {
        bestW = w;
        best = url;
      } else if (url && !best) best = url;
    }
    if (best) return best;
  }
  m = block.match(/\ssrc="(https?:\/\/[^"]+\.(?:jpg|jpeg|webp|png)[^"]*)"/i);
  if (m) return abs(m[1]);
  return "";
}

async function fetchText(url, extra) {
  var r = await kino.fetch(url, {
    headers: hdr(extra),
    timeoutMs: 16000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return await r.text();
}

async function fetchJson(url, extra) {
  var r = await kino.fetch(url, {
    headers: hdr(
      Object.assign({ Accept: "application/json" }, extra || {})
    ),
    timeoutMs: 14000,
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return JSON.parse(await r.text());
}

function parseVideoCards(html) {
  var byId = {};
  var order = [];

  function ensure(id) {
    if (!byId[id]) {
      byId[id] = { id: id, title: "", poster: "", dur: "" };
      order.push(id);
    }
    return byId[id];
  }

  var reBox =
    /<article[^>]*class="[^"]*video-box[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  var m;
  while ((m = reBox.exec(html))) {
    var block = m[1];
    var wm = block.match(/href="(\/watch\/(\d+)\/[^"]*)"/i);
    if (!wm) continue;
    if (/trafficjunky|exoclick|juicyads|data-ad-|class="[^"]*\bad[s-]?\b/i.test(block))
      continue;

    var id = wm[2];
    var rec = ensure(id);

    var poster = extractPoster(block);
    if (poster && !rec.poster) rec.poster = poster;

    var tm =
      block.match(
        /class="[^"]*video-title-text[^"]*"[^>]*>[\s\S]*?<span>([^<]{3,})<\/span>/i
      ) ||
      block.match(/alt="([^"]{3,})"/i);
    if (tm) {
      var title = strip(tm[1]);
      if (title && title.length >= 3) rec.title = title;
    }

    var dm = block.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    if (dm) rec.dur = dm[1];
  }

  var reThumb =
    /<a[^>]+href="(\/watch\/(\d+)\/[^"]*)"[^>]*class="[^"]*video-box-image[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reThumb.exec(html))) {
    var id2 = m[2];
    var block2 = m[3];
    if (/trafficjunky|exoclick|juicyads/i.test(block2)) continue;
    var rec2 = ensure(id2);
    if (!rec2.poster) {
      var p2 = extractPoster(block2);
      if (p2) rec2.poster = p2;
    }
    if (!rec2.title || rec2.title.length < 4) {
      var alt = block2.match(/alt="([^"]{3,})"/i);
      if (alt) rec2.title = strip(alt[1]);
    }
    if (!rec2.dur) {
      var d2 = block2.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (d2) rec2.dur = d2[1];
    }
  }

  var reTitle =
    /<a[^>]+href="(\/watch\/(\d+)\/[^"]*)"[^>]*class="[^"]*video-title-text[^"]*"[^>]*>[\s\S]*?<span>([^<]{3,})<\/span>/gi;
  while ((m = reTitle.exec(html))) {
    var rec3 = ensure(m[2]);
    var t3 = strip(m[3]);
    if (t3 && t3.length >= 3) rec3.title = t3;
  }

  var reAny =
    /<a[^>]+href="(\/watch\/(\d+)\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((m = reAny.exec(html))) {
    var id4 = m[2];
    if (byId[id4] && byId[id4].title && byId[id4].poster) continue;
    var block4 = m[3];
    if (/trafficjunky|exoclick|juicyads|data-ad-/i.test(block4)) continue;
    var rec4 = ensure(id4);
    if (!rec4.poster) {
      var p4 = extractPoster(block4);
      if (p4) rec4.poster = p4;
    }
    if (!rec4.title || rec4.title.length < 4) {
      var a4 = block4.match(/alt="([^"]{3,})"/i);
      if (a4) rec4.title = strip(a4[1]);
    }
  }

  var items = [];
  for (var i = 0; i < order.length; i++) {
    var r = byId[order[i]];
    if (!r.title || r.title.length < 3) continue;
    if (/^\d{1,2}:\d{2}/.test(r.title) && r.title.length < 10) continue;
    if (isBlocked(r.title, r.id)) continue;
    var poster = r.poster || undefined;
    if (poster && /trafficjunky|exoclick|doubleclick|googlesyndication/i.test(poster))
      poster = undefined;

    items.push({
      id: makeId(r.id),
      ref: "yp:" + r.id,
      title: r.title,
      kind: "movie",
      poster: poster,
      quality: r.dur || undefined,
      adult: true,
    });
    if (items.length >= MAX_PAGE) break;
  }
  return items;
}

function preferredQuality() {
  try {
    var q =
      (kino.config && kino.config.get && kino.config.get("quality")) || "auto";
    return String(q || "auto").toLowerCase();
  } catch (e) {
    return "auto";
  }
}

function pickStream(defs, want) {
  if (!Array.isArray(defs) || !defs.length) return null;

  var hls = defs.filter(function (d) {
    return d && d.format === "hls" && d.videoUrl;
  });
  var mp4 = defs.filter(function (d) {
    return d && d.format === "mp4" && d.videoUrl;
  });

  function heightOf(d) {
    var h = parseInt(d.height || d.quality || "0", 10);
    if (!h && d.quality)
      h = parseInt(String(d.quality).replace(/p/i, ""), 10);
    return h || 0;
  }

  function sortDesc(a, b) {
    return heightOf(b) - heightOf(a);
  }

  hls.sort(sortDesc);
  mp4.sort(sortDesc);

  var pool = hls.length ? hls : mp4;
  if (!pool.length) return null;
  if (want === "auto" || !want) return pool[0];

  var target = parseInt(want, 10) || 720;
  var exact = pool.find(function (d) {
    return heightOf(d) === target;
  });
  if (exact) return exact;

  var lower = pool.filter(function (d) {
    return heightOf(d) <= target;
  });
  if (lower.length) return lower[0];
  return pool[pool.length - 1] || pool[0];
}

export async function search(query) {
  var q = (query && query.q) || "";
  if (!q || !String(q).trim()) return [];

  var page = 1;
  if (query.cursor) {
    var cm = String(query.cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }

  var url =
    BASE +
    "/search/?query=" +
    encodeURIComponent(String(q).trim()) +
    "&page=" +
    page;

  var html = await fetchText(url);
  var items = parseVideoCards(html);

  var next = null;
  if (items.length >= 16 && page < 10) next = "p=" + (page + 1);

  if (next) return { items: items, next: next };
  return items;
}

export async function home() {
  var rows = [];

  try {
    var homeHtml = await fetchText(BASE + "/");
    var rec = parseVideoCards(homeHtml);
    if (rec.length) {
      rows.push({
        id: "recommended",
        title: "Recomendados",
        items: rec.slice(0, HOME_ROW),
        ref: "list:recommended",
      });
    }
  } catch (e) {
    kino.log && kino.log("home recommended: " + e.message);
  }

  try {
    var newHtml = await fetchText(BASE + "/browse/");
    var neu = parseVideoCards(newHtml);
    if (neu.length) {
      rows.push({
        id: "newest",
        title: "Recientes",
        items: neu.slice(0, HOME_ROW),
        ref: "list:browse",
      });
    }
  } catch (e) {}

  var cats = [
    { slug: "amateur", title: "Amateur" },
    { slug: "milf", title: "MILF" },
    { slug: "big-tits", title: "Big Tits" },
    { slug: "anal", title: "Anal" },
  ];

  for (var i = 0; i < cats.length; i++) {
    try {
      var cHtml = await fetchText(BASE + "/category/" + cats[i].slug + "/");
      var cItems = parseVideoCards(cHtml);
      if (cItems.length >= 4) {
        rows.push({
          id: "cat-" + cats[i].slug,
          title: cats[i].title,
          items: cItems.slice(0, HOME_ROW),
          ref: "cat:" + cats[i].slug,
        });
      }
    } catch (e) {}
  }

  return rows;
}

export async function browse(ref, cursor) {
  var page = 1;
  if (cursor) {
    var cm = String(cursor).match(/p=(\d+)/);
    if (cm) page = parseInt(cm[1], 10) || 1;
  }

  var url = BASE + "/browse/?page=" + page;
  var r = String(ref || "");

  if (r.indexOf("list:browse") === 0 || r.indexOf("list:recommended") === 0) {
    url = BASE + "/browse/?page=" + page;
  } else if (r.indexOf("cat:") === 0) {
    var slug = r.slice(4);
    url =
      BASE +
      "/category/" +
      encodeURIComponent(slug) +
      "/?page=" +
      page;
  } else {
    url = BASE + "/browse/?page=" + page;
  }

  var html = await fetchText(url);
  var items = parseVideoCards(html);

  var next = null;
  if (items.length >= 16 && page < 15) next = "p=" + (page + 1);

  return { items: items, next: next };
}

export async function resolve(ref) {
  var id = String(ref || "")
    .replace(/^yp:/, "")
    .trim();
  if (!/^\d+$/.test(id)) throw new Error("Ref inválido");

  var pageUrl = BASE + "/watch/" + id + "/";
  var html = await fetchText(pageUrl);

  var hlsEndpoint = null;
  var mp4Endpoint = null;

  var mdMatch = html.match(
    /"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])\s*[,}]/
  );
  if (mdMatch) {
    try {
      var defs = JSON.parse(mdMatch[1]);
      for (var i = 0; i < defs.length; i++) {
        var d = defs[i];
        if (d.format === "hls" && d.videoUrl) hlsEndpoint = d.videoUrl;
        if (d.format === "mp4" && d.videoUrl) mp4Endpoint = d.videoUrl;
      }
    } catch (e) {}
  }

  if (!hlsEndpoint) {
    var hm = html.match(
      /https?:\\\/\\\/www\.youporn\.com\\\/media\\\/hls\\\/\?s=[^"\\]+/
    );
    if (hm) hlsEndpoint = hm[0].replace(/\\\//g, "/");
  }
  if (!mp4Endpoint) {
    var mm = html.match(
      /https?:\\\/\\\/www\.youporn\.com\\\/media\\\/mp4\\\/\?s=[^"\\]+/
    );
    if (mm) mp4Endpoint = mm[0].replace(/\\\//g, "/");
  }

  if (!hlsEndpoint && !mp4Endpoint) {
    try {
      var old = await fetchJson(
        BASE + "/api/video/media_definitions/" + id + "/"
      );
      if (Array.isArray(old)) {
        var picked = pickStream(old, preferredQuality());
        if (picked && picked.videoUrl) {
          return {
            url: picked.videoUrl,
            mime:
              picked.format === "hls"
                ? "application/x-mpegURL"
                : "video/mp4",
            headers: { "User-Agent": UA, Referer: pageUrl },
            label: (picked.quality || picked.height || "") + "p",
          };
        }
      }
    } catch (e) {}
    throw new Error("No se encontraron streams reproducibles");
  }

  var want = preferredQuality();
  var streamDefs = null;

  if (hlsEndpoint) {
    try {
      streamDefs = await fetchJson(hlsEndpoint, { Referer: pageUrl });
    } catch (e) {
      kino.log && kino.log("hls endpoint fail: " + e.message);
    }
  }
  if ((!streamDefs || !streamDefs.length) && mp4Endpoint) {
    try {
      streamDefs = await fetchJson(mp4Endpoint, { Referer: pageUrl });
    } catch (e) {}
  }

  if (!streamDefs || !streamDefs.length) {
    throw new Error("Respuesta de media vacía");
  }

  var best = pickStream(streamDefs, want);
  if (!best || !best.videoUrl) throw new Error("Sin URL de vídeo válida");

  var mime =
    best.format === "hls" || /\.m3u8/i.test(best.videoUrl)
      ? "application/x-mpegURL"
      : "video/mp4";

  var label = "";
  if (best.quality)
    label =
      String(best.quality) +
      (String(best.quality).indexOf("p") > -1 ? "" : "p");
  else if (best.height) label = best.height + "p";

  var alts = [];
  var seenQ = {};
  for (var j = 0; j < streamDefs.length; j++) {
    var s = streamDefs[j];
    if (!s.videoUrl) continue;
    var qh = s.quality || s.height || "";
    var key = String(qh);
    if (seenQ[key]) continue;
    seenQ[key] = true;
    if (s.videoUrl === best.videoUrl) continue;
    alts.push({
      url: s.videoUrl,
      mime:
        s.format === "hls" || /\.m3u8/i.test(s.videoUrl)
          ? "application/x-mpegURL"
          : "video/mp4",
      headers: { "User-Agent": UA, Referer: pageUrl },
      label: key + (String(key).indexOf("p") > -1 ? "" : "p"),
    });
  }

  alts.sort(function (a, b) {
    return (parseInt(b.label, 10) || 0) - (parseInt(a.label, 10) || 0);
  });

  return {
    url: best.videoUrl,
    mime: mime,
    headers: {
      "User-Agent": UA,
      Referer: pageUrl,
      Origin: BASE,
    },
    label: label || undefined,
    alternatives: alts.length ? alts.slice(0, 6) : undefined,
  };
}
