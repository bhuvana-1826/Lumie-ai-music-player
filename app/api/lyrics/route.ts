import { NextResponse } from "next/server";

function clean(s: string) {
  return (s || "").trim();
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = clean(searchParams.get("title") || "");
  const artist = clean(searchParams.get("artist") || "");

  if (!title) return NextResponse.json({ error: "Missing title" }, { status: 400 });

  // 1) LRCLIB (synced if available)
  try {
    const qs = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });

    const r = await fetch(`https://lrclib.net/api/get?${qs.toString()}`, {
      cache: "no-store",
      headers: { "User-Agent": "Lumie/1.0" },
    });

    if (r.ok) {
      const j: any = await r.json();
      const synced = clean(j?.syncedLyrics || "");
      const plain = clean(j?.plainLyrics || "");

      if (synced) return NextResponse.json({ lyrics: synced, provider: "lrclib_synced" }, { status: 200 });
      if (plain) return NextResponse.json({ lyrics: plain, provider: "lrclib_plain" }, { status: 200 });
    }
  } catch {
    // ignore
  }

  // 2) lyrics.ovh fallback (plain only)
  try {
    if (artist) {
      const r = await fetch(
        `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
        { cache: "no-store" }
      );

      if (r.ok) {
        const j: any = await r.json();
        const lyr = clean(j?.lyrics || "");
        if (lyr) return NextResponse.json({ lyrics: lyr, provider: "lyrics_ovh_plain" }, { status: 200 });
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
