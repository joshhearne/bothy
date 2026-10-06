import { describe, expect, it } from "vitest";
import { embedVideos, videoAt } from "./video";

describe("videoAt", () => {
  it("knows a video on the hosts it embeds, by the addresses they use", () => {
    expect(videoAt("https://player.vimeo.com/video/657625091?api=1&player_id=x")?.watchUrl).toBe("https://vimeo.com/657625091");
    expect(videoAt("https://vimeo.com/657625091")?.embedUrl).toBe("https://player.vimeo.com/video/657625091");
    expect(videoAt("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")?.embedUrl).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(videoAt("https://youtu.be/dQw4w9WgXcQ")?.watchUrl).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(videoAt("https://www.youtube.com/embed/dQw4w9WgXcQ")?.id).toBe("dQw4w9WgXcQ");
  });

  it("refuses other hosts, and ids of the wrong shape", () => {
    expect(videoAt("https://vimeo.com.evil.example/video/657625091")).toBeNull();
    expect(videoAt("https://example.com/vimeo.com/video/1")).toBeNull();
    expect(videoAt("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(videoAt("https://vimeo.com/about")).toBeNull();
  });
});

describe("embedVideos", () => {
  it("draws a paragraph that is only a video link as the player, with the link under it", () => {
    const html = '<p>Before</p><p><a href="https://vimeo.com/657625091">Watch the video</a></p><p>After</p>';
    const out = embedVideos(html);
    expect(out).toContain('<iframe src="https://player.vimeo.com/video/657625091" title="Watch the video"');
    expect(out).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"');
    expect(out).toContain('<a href="https://vimeo.com/657625091" target="_blank" rel="noopener noreferrer nofollow">Watch the video</a>');
    expect(out).toMatch(/^<p>Before<\/p><div class="kb-video">.*<\/div><p>After<\/p>$/);
  });

  it("leaves a link with words around it, and a link elsewhere, alone", () => {
    const inline = '<p>See <a href="https://vimeo.com/657625091">this</a> first.</p>';
    expect(embedVideos(inline)).toBe(inline);
    const other = '<p><a href="https://example.com/video/1">Watch</a></p>';
    expect(embedVideos(other)).toBe(other);
  });
});
