// app/lib/commands.ts

export type Track = {
  id: number;
  title: string;
  artist?: string;
  fileLabel?: string;
  kind?: "demo" | "upload";
  src?: string;
};

export type LoopMode = "1x" | "2x" | "3x" | "infinity";

export type CommandContext = {
  tracks: Track[];
  currentTrackIndex: number;
  currentTrackId?: number;

  isPlaying: boolean;
  currentTime?: number;
  duration?: number;

  play: () => void | Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;

  next: () => void;
  prev: () => void;

  seekBy: (deltaSeconds: number) => void;
  seekTo: (seconds: number) => void;

  playTrackIndex: (index: number, opts?: { autoplay?: boolean }) => void;

  shuffleOn: boolean;
  setShuffle: (on: boolean) => void;

  setLoopMode: (mode: LoopMode) => void;

  setSleepTimerInSeconds: (seconds: number) => void;
  setSleepTimerAtSeconds: (positionSeconds: number) => void;
  cancelSleepTimer: () => void;

  toggleLikeTrackId: (id: number) => void;

  openPlaylist: () => void;
  closePlaylist: () => void;

  openLyrics: () => void;
  closeLyrics: () => void;
  fetchLyrics: () => void;

  openProfile: () => void;
  closeProfile: () => void;
};

function normalize(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[“”"']/g, "")
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceNumberWords(s: string): string {
  const map: Record<string, string> = {
    zero: "0",
    one: "1",
    two: "2",
    three: "3",
    four: "4",
    five: "5",
    six: "6",
    seven: "7",
    eight: "8",
    nine: "9",
    ten: "10",
    eleven: "11",
    twelve: "12",
    thirteen: "13",
    fourteen: "14",
    fifteen: "15",
    sixteen: "16",
    seventeen: "17",
    eighteen: "18",
    nineteen: "19",
    twenty: "20",
    thirty: "30",
    forty: "40",
    fifty: "50",
    sixty: "60",
    seventy: "70",
    eighty: "80",
    ninety: "90",
  };

  return s.replace(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
    (m) => map[m] || m
  );
}

function preprocess(input: string): string {
  let s = replaceNumberWords(normalize(input));

  s = s
    .replace(/\bnext song\b/g, "next")
    .replace(/\bnext track\b/g, "next")
    .replace(/\bprevious song\b/g, "previous")
    .replace(/\bprevious track\b/g, "previous")
    .replace(/\bprev song\b/g, "previous")
    .replace(/\bprev track\b/g, "previous")
    .replace(/\bplay the next\b/g, "play next")
    .replace(/\bplay the previous\b/g, "play previous")
    .replace(/\bplay previous one\b/g, "play previous")
    .replace(/\bplay next one\b/g, "play next")
    .replace(/\bsecs\b/g, "seconds")
    .replace(/\bsec\b/g, "seconds")
    .replace(/\bmins\b/g, "minutes")
    .replace(/\bmin\b/g, "minutes")
    .replace(/\bhrs\b/g, "hours")
    .replace(/\bhr\b/g, "hours")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

function tokenize(s: string): string[] {
  return preprocess(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/g)
    .filter(Boolean);
}

function parseTimecodeSeconds(raw: string): number | null {
  const s = preprocess(raw);

  const m1 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m1) {
    const mm = Number(m1[1]);
    const ss = Number(m1[2]);
    if (Number.isFinite(mm) && Number.isFinite(ss)) return mm * 60 + ss;
  }

  const m2 = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (m2) {
    const hh = Number(m2[1]);
    const mm = Number(m2[2]);
    const ss = Number(m2[3]);
    if (Number.isFinite(hh) && Number.isFinite(mm) && Number.isFinite(ss)) {
      return hh * 3600 + mm * 60 + ss;
    }
  }

  return null;
}

function parseDurationSeconds(raw: string): number | null {
  const s = preprocess(raw);

  const tc = parseTimecodeSeconds(s);
  if (tc !== null) return tc;

  let total = 0;

  const h = s.match(/(\d+)\s*(h|hour|hours)\b/);
  const m = s.match(/(\d+)\s*(m|minute|minutes)\b/);
  const sec = s.match(/(\d+)\s*(s|second|seconds)\b/);

  if (h) total += Number(h[1]) * 3600;
  if (m) total += Number(m[1]) * 60;
  if (sec) total += Number(sec[1]);

  if (total === 0) {
    const justNum = s.match(/\b(\d+)\b/);
    if (justNum) total = Number(justNum[1]);
  }

  return total > 0 ? total : null;
}

function loopFromText(s: string): LoopMode | null {
  const x = preprocess(s);
  if (/\b(infinity|infinite|forever|∞)\b/.test(x)) return "infinity";
  if (/\b(3x|three times|loop 3|loop three|three)\b/.test(x)) return "3x";
  if (/\b(2x|two times|loop 2|loop two|two)\b/.test(x)) return "2x";
  if (/\b(1x|one time|loop 1|loop one|one)\b/.test(x)) return "1x";
  return null;
}

function isGenericPlayQuery(q: string): boolean {
  const s = preprocess(q);
  return (
    s === "song" ||
    s === "music" ||
    s === "track" ||
    s === "the song" ||
    s === "the track" ||
    s === "some song" ||
    s === "current song"
  );
}

function currentTrack(ctx: CommandContext): Track | null {
  return ctx.tracks[ctx.currentTrackIndex] ?? null;
}

function currentTrackTitle(ctx: CommandContext): string {
  return currentTrack(ctx)?.title || "current track";
}

function quoteTrack(title?: string) {
  return title ? `"${title}"` : "current track";
}

function bestFuzzyTrackIndex(query: string, tracks: Track[]): number {
  const q = preprocess(query).replace(/^(?:the|a|an)\s+/g, "").trim();
  if (!q) return -1;

  const qTokens = tokenize(q);
  if (!qTokens.length) return -1;

  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < tracks.length; i++) {
    const title = tracks[i]?.title || "";
    const artist = tracks[i]?.artist || "";
    const hay = preprocess(`${title} ${artist}`);
    const titleNorm = preprocess(title);

    if (titleNorm === q) {
      return i;
    }

    let score = 0;

    if (hay === q) score += 100;
    if (hay.startsWith(q)) score += 45;
    if (hay.includes(q)) score += 25;

    const hTokens = tokenize(hay);
    const hSet = new Set(hTokens);
    let hits = 0;
    for (const t of qTokens) {
      if (hSet.has(t)) hits++;
    }
    score += hits * 8;

    if (titleNorm.includes(q)) score += 10;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestScore >= 10 ? bestIdx : -1;
}

function humanizeSeconds(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return mm > 0 ? `${mm}m ${ss}s` : `${ss}s`;
}

function cleanDanglingConnectors(s: string): string {
  return preprocess(s)
    .replace(/\b(and|then)\b\s*$/g, "")
    .replace(/^\b(and|then)\b\s*/g, "")
    .trim();
}

function splitCommandParts(input: string): string[] {
  return preprocess(input)
    .split(/\b(?:and then|then|and)\b|[,;]+/g)
    .map((p) => cleanDanglingConnectors(p))
    .filter(Boolean);
}

function deferSleepTimer(ctx: CommandContext, seconds: number, delayMs = 260) {
  setTimeout(() => {
    ctx.setSleepTimerInSeconds(seconds);
  }, delayMs);
}

function tryHandlePlayNextPrev(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  const wantsPlayNext =
    /\bplay\b.*\bnext\b/.test(s) ||
    s === "next" ||
    /\bnext\b/.test(s);

  const wantsPlayPrev =
    /\bplay\b.*\b(previous|prev|back)\b/.test(s) ||
    s === "previous" ||
    /\b(previous|prev|back)\b/.test(s);

  if (wantsPlayNext) {
    const len = ctx.tracks.length;
    if (!len) return "No tracks available.";
    const idx = (ctx.currentTrackIndex + 1) % len;
    const title = ctx.tracks[idx]?.title || "next track";
    ctx.playTrackIndex(idx, { autoplay: true });
    return `Playing next track: ${quoteTrack(title)}`;
  }

  if (wantsPlayPrev) {
    const len = ctx.tracks.length;
    if (!len) return "No tracks available.";
    const idx = (ctx.currentTrackIndex - 1 + len) % len;
    const title = ctx.tracks[idx]?.title || "previous track";
    ctx.playTrackIndex(idx, { autoplay: true });
    return `Playing previous track: ${quoteTrack(title)}`;
  }

  return null;
}

function tryHandlePlayTrack(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  const nextPrev = tryHandlePlayNextPrev(s, ctx);
  if (nextPrev) return nextPrev;

  const n = s.match(/\bplay\s*(?:song|track)?\s*(?:number\s*)?(?:#\s*)?(\d+)\b/);
  if (n) {
    const idx = Number(n[1]) - 1;
    if (Number.isFinite(idx) && idx >= 0 && idx < ctx.tracks.length) {
      const title = ctx.tracks[idx]?.title || `track ${idx + 1}`;
      ctx.playTrackIndex(idx, { autoplay: true });
      return `Playing ${quoteTrack(title)}`;
    }
    return `Track ${n[1]} was not found. Try a number between 1 and ${ctx.tracks.length}.`;
  }

  if (/\b(replay|restart|start over)\b/.test(s)) {
    ctx.seekTo(0);
    void ctx.play();
    return `Replaying ${quoteTrack(currentTrackTitle(ctx))}`;
  }

  const m = s.match(/\bplay\s+(.+)$/);
  if (m) {
    let q = (m[1] || "").trim();

    if (isGenericPlayQuery(q)) {
      void ctx.play();
      return `Playing ${quoteTrack(currentTrackTitle(ctx))}`;
    }

    q = q.replace(/^(?:song|track)\s+/, "").trim();
    if (!q || /^\d+$/.test(q)) return null;

    const hit = bestFuzzyTrackIndex(q, ctx.tracks);
    if (hit >= 0) {
      const title = ctx.tracks[hit]?.title || q;
      ctx.playTrackIndex(hit, { autoplay: true });
      return `Playing ${quoteTrack(title)}`;
    }

    return `Track "${q}" was not found. Try another title from the playlist.`;
  }

  return null;
}

function tryHandlePlayAndStopCompound(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  if (!/\bplay\b/.test(s)) return null;
  if (!/\bstop\b/.test(s) && !/\btimer\b/.test(s) && !/\bsleep\b/.test(s)) return null;

  const m =
    s.match(/\bstop\s*(?:in|after)\s*(.+)$/) ||
    s.match(/\b(?:set\s*)?(?:sleep\s*)?timer\s*(?:for|in|after)\s*(.+)$/) ||
    s.match(/\bsleep\s*(?:in|after)\s*(.+)$/);

  if (!m) return null;

  const seconds = parseDurationSeconds(m[1] || "");
  if (!seconds || seconds <= 0) return "I couldn’t understand the timer duration.";

  let playPart = s.replace(m[0], "").trim();
  playPart = cleanDanglingConnectors(playPart);

  if (
    /\bplay\b.*\bnext\b/.test(playPart) ||
    playPart === "next" ||
    /\bnext\b/.test(playPart)
  ) {
    const len = ctx.tracks.length;
    if (!len) return "No tracks available.";
    const idx = (ctx.currentTrackIndex + 1) % len;
    const title = ctx.tracks[idx]?.title || "next track";
    ctx.playTrackIndex(idx, { autoplay: true });
    deferSleepTimer(ctx, seconds, 320);
    return `Playing next track ${quoteTrack(title)} and stopping in ${humanizeSeconds(seconds)}`;
  }

  if (
    /\bplay\b.*\b(previous|prev|back)\b/.test(playPart) ||
    playPart === "previous" ||
    /\b(previous|prev|back)\b/.test(playPart)
  ) {
    const len = ctx.tracks.length;
    if (!len) return "No tracks available.";
    const idx = (ctx.currentTrackIndex - 1 + len) % len;
    const title = ctx.tracks[idx]?.title || "previous track";
    ctx.playTrackIndex(idx, { autoplay: true });
    deferSleepTimer(ctx, seconds, 320);
    return `Playing previous track ${quoteTrack(title)} and stopping in ${humanizeSeconds(seconds)}`;
  }

  const handled = tryHandlePlayTrack(playPart, ctx);
  if (handled) {
    if (/^Playing ".*"$/.test(handled) || /^Playing track/.test(handled)) {
      deferSleepTimer(ctx, seconds, 320);
    } else {
      deferSleepTimer(ctx, seconds, 180);
    }
    return `${handled} and stopping in ${humanizeSeconds(seconds)}`;
  }

  if (/\bplay\b/.test(playPart)) {
    void ctx.play();
    deferSleepTimer(ctx, seconds, 180);
    return `Playing ${quoteTrack(currentTrackTitle(ctx))} and stopping in ${humanizeSeconds(seconds)}`;
  }

  return null;
}

function tryHandleTimerIn(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  let m = s.match(/\bstop\s*(?:in|after)\s*(.+)$/);
  if (!m) m = s.match(/\bsleep\s*(?:in|after)\s*(.+)$/);
  if (!m) m = s.match(/\b(?:set\s*)?(?:sleep\s*)?timer\s*(?:for|in|after)\s*(.+)$/);
  if (!m) return null;

  const seconds = parseDurationSeconds(m[1] || "");
  if (!seconds || seconds <= 0) return "I couldn’t understand the timer duration.";

  ctx.setSleepTimerInSeconds(seconds);
  return `Stopping in ${humanizeSeconds(seconds)}`;
}

function tryHandleStopAt(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);
  const m = s.match(/\bstop\s*at\s*(.+)$/);
  if (!m) return null;

  const pos = parseTimecodeSeconds(m[1] || "");
  if (pos === null) return "I couldn’t understand that stop time.";

  ctx.setSleepTimerAtSeconds(pos);
  const mm = Math.floor(pos / 60);
  const ss = String(pos % 60).padStart(2, "0");
  return `Stopping at ${mm}:${ss}`;
}

function tryHandleSeek(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  const seekToMatch =
    s.match(/\b(?:seek|jump|go)\s*(?:to)?\s*(\d{1,2}:\d{2}(?::\d{2})?)\b/) ||
    s.match(/\bskip to\s*(\d{1,2}:\d{2}(?::\d{2})?)\b/);

  if (seekToMatch) {
    const sec = parseTimecodeSeconds(seekToMatch[1]);
    if (sec !== null) {
      ctx.seekTo(sec);
      return `Jumping to ${seekToMatch[1]}`;
    }
  }

  const forward =
    s.match(/\b(?:forward|ahead|skip ahead|plus|\+)\s*(\d+)\s*(second|seconds|s)\b/);
  if (forward) {
    const sec = Number(forward[1]);
    if (Number.isFinite(sec) && sec > 0) {
      ctx.seekBy(sec);
      return `Skipping forward ${sec} seconds`;
    }
  }

  const backward =
    s.match(/\b(?:rewind|back|minus|-)\s*(\d+)\s*(second|seconds|s)\b/);
  if (backward) {
    const sec = Number(backward[1]);
    if (Number.isFinite(sec) && sec > 0) {
      ctx.seekBy(-sec);
      return `Rewinding ${sec} seconds`;
    }
  }

  return null;
}

function tryHandleLyrics(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);
  const title = currentTrackTitle(ctx);

  if (/\b(fetch|get|retry|refresh)\b.*\blyrics\b/.test(s)) {
    ctx.fetchLyrics();
    return `Fetching lyrics for ${quoteTrack(title)}`;
  }

  if (/\b(open|show)\b.*\blyrics\b/.test(s)) {
    ctx.openLyrics();
    return `Opening lyrics for ${quoteTrack(title)}`;
  }

  if (/\b(close|hide)\b.*\blyrics\b/.test(s)) {
    ctx.closeLyrics();
    return "Closing lyrics";
  }

  return null;
}

function tryHandlePlaylist(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  if (/\b(open|show)\b.*\bplaylist\b/.test(s)) {
    ctx.openPlaylist();
    return "Opening playlist";
  }

  if (/\b(close|hide)\b.*\bplaylist\b/.test(s)) {
    ctx.closePlaylist();
    return "Closing playlist";
  }

  return null;
}

function tryHandleProfile(raw: string, ctx: CommandContext): string | null {
  const s = preprocess(raw);

  if (/\b(open|show)\b.*\b(profile|settings)\b/.test(s)) {
    ctx.openProfile();
    return "Opening profile settings";
  }

  if (/\b(close|hide)\b.*\b(profile|settings)\b/.test(s)) {
    ctx.closeProfile();
    return "Closing profile settings";
  }

  return null;
}

function tryHandleSingleCommand(raw: string, ctx: CommandContext): string | null {
  const p = cleanDanglingConnectors(raw);
  if (!p) return null;

  const timerCancel =
    /\b(cancel|clear|remove)\b.*\b(timer|sleep)\b/.test(p) ||
    /\bcancel timer\b/.test(p) ||
    /\bcancel sleep\b/.test(p);

  if (timerCancel) {
    ctx.cancelSleepTimer();
    return "Timer cancelled";
  }

  const stopIn = tryHandleTimerIn(p, ctx);
  if (stopIn) return stopIn;

  const stopAt = tryHandleStopAt(p, ctx);
  if (stopAt) return stopAt;

  const lyrics = tryHandleLyrics(p, ctx);
  if (lyrics) return lyrics;

  const playlist = tryHandlePlaylist(p, ctx);
  if (playlist) return playlist;

  const profile = tryHandleProfile(p, ctx);
  if (profile) return profile;

  const playTrack = tryHandlePlayTrack(p, ctx);
  if (playTrack) return playTrack;

  if (/\b(play|resume)\b/.test(p)) {
    void ctx.play();
    return `Playing ${quoteTrack(currentTrackTitle(ctx))}`;
  }

  if (/\bpause\b/.test(p)) {
    ctx.pause();
    return `Pausing ${quoteTrack(currentTrackTitle(ctx))}`;
  }

  if (/\btoggle\b.*\bplay\b/.test(p)) {
    ctx.togglePlay();
    return ctx.isPlaying
      ? `Pausing ${quoteTrack(currentTrackTitle(ctx))}`
      : `Playing ${quoteTrack(currentTrackTitle(ctx))}`;
  }

  if (p === "stop") {
    ctx.stop();
    return `Stopping ${quoteTrack(currentTrackTitle(ctx))}`;
  }

  if (p === "next") {
    if (!ctx.tracks.length) return "No tracks available.";
    const idx = (ctx.currentTrackIndex + 1) % ctx.tracks.length;
    const title = ctx.tracks[idx]?.title || "next track";
    ctx.next();
    return `Playing next track: ${quoteTrack(title)}`;
  }

  if (/^(previous|prev|back)$/.test(p)) {
    if (!ctx.tracks.length) return "No tracks available.";
    const idx = (ctx.currentTrackIndex - 1 + ctx.tracks.length) % ctx.tracks.length;
    const title = ctx.tracks[idx]?.title || "previous track";
    ctx.prev();
    return `Playing previous track: ${quoteTrack(title)}`;
  }

  if (/\bshuffle\b/.test(p)) {
    const on = /\bon\b/.test(p) || /\benable\b/.test(p);
    const off = /\boff\b/.test(p) || /\bdisable\b/.test(p);

    if (on && !off) {
      ctx.setShuffle(true);
      return "Shuffle enabled";
    }

    if (off && !on) {
      ctx.setShuffle(false);
      return "Shuffle disabled";
    }

    ctx.setShuffle(!ctx.shuffleOn);
    return `Shuffle ${!ctx.shuffleOn ? "enabled" : "disabled"}`;
  }

  if (/\bloop\b/.test(p) || /\b(infinity|forever|∞)\b/.test(p)) {
    const mode = loopFromText(p);
    if (mode) {
      ctx.setLoopMode(mode);
      return `Loop mode set to ${mode === "infinity" ? "infinity" : mode}`;
    }
  }

  const seek = tryHandleSeek(p, ctx);
  if (seek) return seek;

  if (/\b(unlike|remove like)\b/.test(p)) {
    if (ctx.currentTrackId != null) {
      ctx.toggleLikeTrackId(ctx.currentTrackId);
      return `Removed ${quoteTrack(currentTrackTitle(ctx))} from liked songs`;
    }
    return "No active track to unlike.";
  }

  if (/\b(like|favorite|favourite)\b/.test(p)) {
    if (ctx.currentTrackId != null) {
      ctx.toggleLikeTrackId(ctx.currentTrackId);
      return `Added ${quoteTrack(currentTrackTitle(ctx))} to liked songs`;
    }
    return "No active track to like.";
  }

  return null;
}

export function runCommand(raw: string, ctx: CommandContext): string {
  const input = cleanDanglingConnectors(raw);
  if (!input) return "Please say or type a command.";

  const compound = tryHandlePlayAndStopCompound(input, ctx);
  if (compound) return compound;

  const parts = splitCommandParts(input);
  const actions: string[] = [];

  for (const part of parts) {
    const result = tryHandleSingleCommand(part, ctx);
    if (result) actions.push(result);
  }

  return actions.length
    ? actions.join(" · ")
    : "Sorry, I didn’t understand that command. Try play, pause, next, loop 2x, or open lyrics.";
}