/**
 * Videos a page embeds from a host people watch them on. A crawl keeps one
 * as a link to the page where it is watched, which reads, searches, and
 * travels well; the article page turns that link back into a player. Only
 * hosts named here are embedded, and only with an id of the shape they use,
 * so nothing from an article reaches the frame but digits and letters.
 */

export type Video = { host: "vimeo" | "youtube"; id: string; watchUrl: string; embedUrl: string };

const HOSTS: { host: Video["host"]; match: RegExp; watch: (id: string) => string; embed: (id: string) => string }[] = [
  {
    host: "vimeo",
    // vimeo.com/123, vimeo.com/video/123, player.vimeo.com/video/123
    match: /^https?:\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:[/?#]|$)/i,
    watch: (id) => `https://vimeo.com/${id}`,
    embed: (id) => `https://player.vimeo.com/video/${id}`,
  },
  {
    host: "youtube",
    // youtube.com/watch?v=ID, youtube.com/embed/ID, youtube-nocookie.com/embed/ID, youtu.be/ID
    match:
      /^https?:\/\/(?:(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&/?#]|$)/i,
    watch: (id) => `https://www.youtube.com/watch?v=${id}`,
    embed: (id) => `https://www.youtube-nocookie.com/embed/${id}`,
  },
];

/** The video at an address, when the address is one of a host we embed. */
export function videoAt(url: string): Video | null {
  for (const host of HOSTS) {
    const id = host.match.exec(url.trim())?.[1];
    if (id) return { host: host.host, id, watchUrl: host.watch(id), embedUrl: host.embed(id) };
  }
  return null;
}

const LONE_LINK = /<p>\s*<a\b([^>]*)\bhref="([^"]+)"[^>]*>([^<]*)<\/a>\s*<\/p>/gi;

/**
 * Sanitized article HTML with each paragraph that is only a link to a video
 * drawn as the player, the link kept under it for anyone the frame fails.
 */
export function embedVideos(html: string): string {
  return html.replace(LONE_LINK, (whole, _attributes: string, href: string, label: string) => {
    const video = videoAt(href.replace(/&amp;/g, "&"));
    if (!video) return whole;
    const title = (label.trim() || "Video").replace(/"/g, "&quot;");
    return (
      `<div class="kb-video"><iframe src="${video.embedUrl}" title="${title}" ` +
      `allow="fullscreen; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin" ` +
      `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>` +
      `<p><a href="${video.watchUrl}" target="_blank" rel="noopener noreferrer nofollow">${label}</a></p></div>`
    );
  });
}
