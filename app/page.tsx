"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Heart,
  Shuffle,
  SkipBack,
  SkipForward,
  ListMusic,
  Timer,
  Mic,
  Play,
  Pause,
  X,
  Minus,
  Plus,
  User,
  Music2,
  BookOpenText,
  Upload,
  RotateCcw,
  Sparkles,
  Copy,
  Pencil,
  AlertCircle,
  ChevronDown,
} from "lucide-react";

import { useAudioPlayer } from "./lib/useAudioPlayer";
import { runCommand, type CommandContext, type LoopMode } from "./lib/commands";

type Track = {
  id: number;
  title: string;
  artist?: string;
  fileLabel?: string;
  src?: string;
  kind?: "demo" | "upload";
};

type LyricsProvider =
  | "lrclib_synced"
  | "lrclib_plain"
  | "lyrics_ovh_plain"
  | "manual"
  | "none"
  | string;

type LyricsState = {
  provider: LyricsProvider;
  lyrics: string;
  isSynced: boolean;
  fetchedAt?: number;
  error?: string;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: null | (() => void);
  onend: null | (() => void);
  onerror: null | ((event: { error?: string }) => void);
  onresult: null | ((event: SpeechRecognitionEventLike) => void);
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<{
    isFinal?: boolean;
    0: {
      transcript: string;
    };
  }>;
  resultIndex?: number;
};

type MicMode = "off" | "push" | "handsfree";

type CommandHistoryItem = {
  id: number;
  command: string;
  result: string;
  source: "typed" | "push" | "handsfree";
  createdAt: number;
};

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionCtor;
    SpeechRecognition?: SpeechRecognitionCtor;
  }
}

function fmtTime(sec?: number) {
  const s = Math.max(0, Math.floor(sec ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clean(s?: string) {
  return (s ?? "").trim();
}

function guessTitleArtistFromLabel(label?: string) {
  const raw = (label ?? "")
    .replace(/\.(mp3|wav|m4a|aac|flac)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!raw) return { title: "", artist: "" };

  const separators = [" - ", " – ", " — ", "-", "–", "—"];
  for (const sep of separators) {
    const parts = raw.split(sep).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const first = parts[0];
      const rest = parts.slice(1).join(" - ").trim();

      const firstLooksLikeArtist = /\b(feat\.?|ft\.?|dj|band|orchestra|singers?|mahadevan|sheeran|swift|arijit|kishore|lata)\b/i.test(first) || first.split(" ").length <= 3;
      if (firstLooksLikeArtist) {
        return {
          title: rest,
          artist: first,
        };
      }

      return {
        title: first,
        artist: rest,
      };
    }
  }

  return { title: raw, artist: "" };
}

function prettifyTitle(raw?: string) {
  if (!raw) return "";
  return raw
    .replace(/\.(mp3|wav|m4a|aac|flac)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pickPreviewLines(text: string, n = 3) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, n);
}

function parseLrc(text: string) {
  const lines = text.split("\n");
  const out: Array<{ t: number; text: string }> = [];

  for (const line of lines) {
    const l = line.trim();
    if (!l) continue;

    const matches = [...l.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{1,2}))?\]/g)];
    if (matches.length === 0) continue;

    const content = l
      .replace(/\[(\d{2}):(\d{2})(?:\.(\d{1,2}))?\]/g, "")
      .trim();

    for (const m of matches) {
      const mm = Number(m[1]);
      const ss = Number(m[2]);
      const xx = m[3] ? Number(m[3].padEnd(2, "0")) : 0;
      const t = mm * 60 + ss + xx / 100;
      out.push({ t, text: content });
    }
  }

  out.sort((a, b) => a.t - b.t);

  const dedup: Array<{ t: number; text: string }> = [];
  for (const ln of out) {
    const last = dedup[dedup.length - 1];
    if (last && Math.abs(last.t - ln.t) < 0.001) {
      if (!last.text && ln.text) last.text = ln.text;
      continue;
    }
    dedup.push({ ...ln });
  }

  return dedup;
}

function findActiveIndex(lines: Array<{ t: number; text: string }>, t: number) {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return ans;
}


function hasReasonableTimingSpread(lines: Array<{ t: number; text: string }>) {
  const usable = lines.filter((line) => line.text.trim());

  if (usable.length < 8) return false;

  const sorted = [...usable].sort((a, b) => a.t - b.t);
  const durationSpread = sorted[sorted.length - 1].t - sorted[0].t;

  if (durationSpread < 20) return false;

  const gaps: number[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].t - sorted[i - 1].t;
    if (gap > 0) gaps.push(gap);
  }

  if (!gaps.length) return false;

  const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
  const hugeGapCount = gaps.filter((gap) => gap > 20).length;

  return avgGap >= 0.5 && avgGap <= 12 && hugeGapCount <= Math.max(1, Math.floor(gaps.length * 0.15));
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function hasLrc(text: string) {
  return parseLrc(text).filter((line) => line.text.trim()).length >= 2;
}

const DEMO_TRACKS: Track[] = [
  {
    id: 1,
    title: "Blank Space",
    artist: "Taylor Swift",
    fileLabel: "Blank-Space.mp3",
    src: "/demo/Blank-Space.mp3",
    kind: "demo",
  },
  {
    id: 2,
    title: "Cruel Summer",
    artist: "Taylor Swift",
    fileLabel: "Cruel-Summer.mp3",
    src: "/demo/Cruel-Summer.mp3",
    kind: "demo",
  },
  {
    id: 3,
    title: "Flute Meditation",
    artist: "Ambient",
    fileLabel: "flute-meditation.mp3",
    src: "/demo/flute-meditation.mp3",
    kind: "demo",
  },
  {
    id: 4,
    title: "Forest Ambience",
    artist: "Nature",
    fileLabel: "forest-ambience.mp3",
    src: "/demo/forest-ambience.mp3",
    kind: "demo",
  },
  {
    id: 5,
    title: "Ocean Waves",
    artist: "Nature",
    fileLabel: "ocean-waves.mp3",
    src: "/demo/ocean-waves.mp3",
    kind: "demo",
  },
  {
    id: 6,
    title: "Perfect",
    artist: "Ed Sheeran",
    fileLabel: "Perfect.mp3",
    src: "/demo/Perfect.mp3",
    kind: "demo",
  },
];

function Sheet({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm">
      <div className="flex h-full items-end justify-center p-3 sm:p-4">
        <div className="w-full max-w-[420px] overflow-hidden rounded-[26px] border border-white/10 bg-[#0b0b0b] shadow-[0_30px_120px_rgba(0,0,0,0.85)]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{title}</div>
              {subtitle ? (
                <div className="mt-0.5 truncate text-xs text-white/50">{subtitle}</div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 bg-white/5 p-2 hover:bg-white/10"
              title={`Close ${title}`}
            >
              <X className="h-4 w-4 text-white/80" />
            </button>
          </div>

          <div className="max-h-[78vh] overflow-y-auto px-4 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [tracks, setTracks] = useState<Track[]>(DEMO_TRACKS);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [shuffleOn, setShuffleOn] = useState(false);

  const activeTrack = tracks[currentTrackIndex] ?? null;
  const activeSrc = activeTrack?.src ?? "";

  const player = useAudioPlayer(activeSrc);

  const {
    isReady,
    isPlaying,
    current: currentTime,
    duration,
    loopMode,
    playlistAdvanceSignal,
    stop,
    actions,
  } = player;

  const play = actions.play;
  const pause = actions.pause;
  const seekTo = actions.seekTo;
  const seekBy = actions.seekBy;
  const setLoopModeRaw = actions.setLoopMode;

  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const [commandInput, setCommandInput] = useState("");
  const [lastCommand, setLastCommand] = useState("");
  const [intentText, setIntentText] = useState("—");
  const [commandProcessing, setCommandProcessing] = useState(false);
  const [voiceReplyOn, setVoiceReplyOn] = useState(true);

  const [micMode, setMicMode] = useState<MicMode>("off");
  const [micListening, setMicListening] = useState(false);
  const [micError, setMicError] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listeningText, setListeningText] = useState("");
  const [voiceReplyStatus, setVoiceReplyStatus] = useState("");

  const [lyricsByTrackId, setLyricsByTrackId] = useState<Record<number, LyricsState>>({});
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [lyricsEditMode, setLyricsEditMode] = useState(false);
  const [lyricsSearchEditOpen, setLyricsSearchEditOpen] = useState(false);
  const [lyricsManualDraft, setLyricsManualDraft] = useState("");
  const [lyricsSearchTitleDraft, setLyricsSearchTitleDraft] = useState("");
  const [lyricsSearchArtistDraft, setLyricsSearchArtistDraft] = useState("");
  const [lyricsStatus, setLyricsStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [lyricsOffset, setLyricsOffset] = useState(0.6);

  const [quickOpen, setQuickOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [timerOpen, setTimerOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);

  const [customTimerMin, setCustomTimerMin] = useState("10");
  const [stopAtInput, setStopAtInput] = useState("");

  const lyricsScrollRef = useRef<HTMLDivElement | null>(null);
  const preventAutoScrollUntilRef = useRef<number>(0);
  const lyricsAutoFetchRef = useRef<Record<number, boolean>>({});
  const pendingAutoplayRef = useRef(false);
  const uploadedBlobUrlsRef = useRef<string[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const restartTimeoutRef = useRef<number | null>(null);

  const listeningTextRef = useRef("");
  const voiceQueueRef = useRef(0);
  const micModeRef = useRef<MicMode>("off");
  const recognitionBusyRef = useRef(false);
  const recognitionShouldRestartRef = useRef(false);
  const handsFreeCooldownUntilRef = useRef(0);
  const handsFreeSpeakingRef = useRef(false);

  const commandRunningRef = useRef(false);
  const pendingCommandRef = useRef<null | {
    input: string;
    source: "typed" | "push" | "handsfree";
  }>(null);

  const tracksRef = useRef<Track[]>(tracks);
  const currentTrackIndexRef = useRef(currentTrackIndex);
  const currentTrackRef = useRef<Track | null>(activeTrack);
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const shuffleOnRef = useRef(shuffleOn);
  const stopRuleRef = useRef(stop.rule);
  const runUserCommandRef = useRef<(input: string) => Promise<void>>(async () => {});
  const sleepTimerTargetAtRef = useRef<number | null>(null);
  const sleepTimerTimeoutRef = useRef<number | null>(null);
  const lastPlaylistAdvanceSignalRef = useRef(0);

  const currentTrack = activeTrack;
  const trackId = currentTrack?.id ?? 0;

  const currentLyricsState: LyricsState =
    lyricsByTrackId[trackId] ?? { provider: "none", lyrics: "", isSynced: false };

  const toggle = () => {
    if (isPlaying) pause();
    else void play();
  };

  const effectiveTitleArtist = useMemo(() => {
    const t = currentTrack;
    if (!t) return { title: "", artist: "" };

    const parsed = guessTitleArtistFromLabel(t.fileLabel);
    return {
      title: clean(t.title) || prettifyTitle(parsed.title) || prettifyTitle(t.fileLabel) || "",
      artist: clean(t.artist) || parsed.artist || "",
    };
  }, [currentTrack]);

  const likedCount = useMemo(
    () => Object.values(liked).filter(Boolean).length,
    [liked]
  );

  const handsFreeCooldownRemainingMs =
    micMode === "handsfree"
      ? Math.max(0, handsFreeCooldownUntilRef.current - Date.now())
      : 0;

  const handsFreeStateText = useMemo(() => {
    if (micMode !== "handsfree") return "Off";
    if (handsFreeSpeakingRef.current) return "Speaking";
    if (handsFreeCooldownRemainingMs > 0) return "Cooldown";
    if (micListening) return "Listening for Lumie";
    return "Ready";
  }, [micMode, micListening, handsFreeCooldownRemainingMs, voiceReplyStatus]);

  useEffect(() => {
    listeningTextRef.current = listeningText;
  }, [listeningText]);

  useEffect(() => {
    micModeRef.current = micMode;
  }, [micMode]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  useEffect(() => {
    currentTrackIndexRef.current = currentTrackIndex;
  }, [currentTrackIndex]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  useEffect(() => {
    shuffleOnRef.current = shuffleOn;
  }, [shuffleOn]);

  useEffect(() => {
    const previousRule = stopRuleRef.current;
    const nextRule = stop.rule;

    if (
      nextRule.type === "in" &&
      (previousRule.type !== "in" || nextRule.remainingSec > previousRule.remainingSec + 1)
    ) {
      sleepTimerTargetAtRef.current = null;

      if (sleepTimerTimeoutRef.current) {
        window.clearTimeout(sleepTimerTimeoutRef.current);
        sleepTimerTimeoutRef.current = null;
      }
    }

    stopRuleRef.current = nextRule;
  }, [stop.rule]);

  function extractWakeWordCommand(input: string) {
    const normalized = input
      .trim()
      .toLowerCase()
      .replace(/[.,!?;:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const wakeWords = ["lumie", "lumi", "hey lumie", "hey lumi"];

    for (const wake of wakeWords) {
      if (normalized === wake) return "";
      if (normalized.startsWith(wake + " ")) {
        return normalized.slice(wake.length).trim();
      }
    }

    return "";
  }

  function shouldClearExistingTimerForNewCommand(input: string) {
    const s = input
      .toLowerCase()
      .replace(/[.,!?;:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const mentionsTimerControl =
      /\b(stop|sleep|timer)\b/.test(s) ||
      /\b(cancel|clear|remove)\b.*\b(timer|sleep|stop)\b/.test(s);

    if (mentionsTimerControl) return false;

    const mentionsPlaybackAction =
      /\bplay\b/.test(s) ||
      /\bnext\b/.test(s) ||
      /\bprevious\b/.test(s) ||
      /\bprev\b/.test(s) ||
      /\bback\b/.test(s) ||
      /\bpause\b/.test(s) ||
      /\bresume\b/.test(s) ||
      /\btrack\b/.test(s);

    return mentionsPlaybackAction;
  }

  function getCommandSource(mode: MicMode, rawInput: string): "typed" | "push" | "handsfree" {
    const trimmed = rawInput.trim();
    if (!trimmed) return "typed";
    if (mode === "handsfree") return "handsfree";
    if (mode === "push") return "push";
    return "typed";
  }

  function formatHistoryTime(ts: number) {
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function pushCommandHistory(
    command: string,
    result: string,
    source: "typed" | "push" | "handsfree"
  ) {
    const item: CommandHistoryItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      command,
      result,
      source,
      createdAt: Date.now(),
    };

    setCommandHistory((prev) => [item, ...prev].slice(0, 8));
  }

  function startHandsFreeCooldown(ms = 2500) {
    handsFreeCooldownUntilRef.current = Date.now() + ms;
  }

  function isHandsFreeCoolingDown() {
    return Date.now() < handsFreeCooldownUntilRef.current;
  }

  function stopRecognition() {
    recognitionShouldRestartRef.current = false;

    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }

    try {
      recognitionRef.current?.stop();
    } catch {}

    recognitionBusyRef.current = false;
    setMicListening(false);
  }

  function scheduleHandsFreeRestart() {
    if (!recognitionShouldRestartRef.current) return;
    if (micModeRef.current !== "handsfree") return;

    if (restartTimeoutRef.current) {
      window.clearTimeout(restartTimeoutRef.current);
    }

    const remaining = Math.max(0, handsFreeCooldownUntilRef.current - Date.now());
    const delay = Math.max(500, remaining);

    restartTimeoutRef.current = window.setTimeout(() => {
      if (!recognitionShouldRestartRef.current) return;
      if (micModeRef.current !== "handsfree") return;
      if (recognitionBusyRef.current) return;

      try {
        recognitionBusyRef.current = true;
        recognitionRef.current?.start();
      } catch {
        recognitionBusyRef.current = false;
        scheduleHandsFreeRestart();
      }
    }, delay);
  }

  function speakReply(text: string) {
    if (!voiceReplyOn) return;
    if (!("speechSynthesis" in window)) {
      setVoiceReplyStatus("Voice reply is not supported in this browser.");
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) return;

    const queueId = Date.now();
    voiceQueueRef.current = queueId;

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 1;

      utterance.onstart = () => {
        if (voiceQueueRef.current !== queueId) return;
        handsFreeSpeakingRef.current = true;
        if (micModeRef.current === "handsfree") {
          startHandsFreeCooldown(Math.max(2200, Math.min(5000, trimmed.length * 90)));
        }
        setVoiceReplyStatus(`Speaking: ${trimmed}`);
      };

      utterance.onend = () => {
        if (voiceQueueRef.current !== queueId) return;
        handsFreeSpeakingRef.current = false;
        if (micModeRef.current === "handsfree") {
          startHandsFreeCooldown(1200);
        }
        setVoiceReplyStatus("");
      };

      utterance.onerror = () => {
        if (voiceQueueRef.current !== queueId) return;
        handsFreeSpeakingRef.current = false;
        if (micModeRef.current === "handsfree") {
          startHandsFreeCooldown(1200);
        }
        setVoiceReplyStatus("Voice reply failed.");
      };

      window.speechSynthesis.speak(utterance);
    } catch {
      handsFreeSpeakingRef.current = false;
      setVoiceReplyStatus("Voice reply failed.");
    }
  }

  useEffect(() => {
    const SpeechCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSpeechSupported(!!SpeechCtor);

    if (!SpeechCtor) return;

    const recognition = new SpeechCtor();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      recognitionBusyRef.current = true;
      setMicListening(true);
      setMicError("");
      setListeningText(
        micModeRef.current === "handsfree" ? "Lumie is listening..." : "Listening..."
      );
    };

    recognition.onresult = (event) => {
      let transcript = "";
      let finalTranscript = "";

      for (let i = event.resultIndex ?? 0; i < event.results.length; i++) {
        const result = event.results[i];
        const part = result[0]?.transcript ?? "";
        transcript += part;
        if (result.isFinal) {
          finalTranscript += part;
        }
      }

      const cleanTranscript = transcript.trim();
      if (cleanTranscript) {
        setListeningText(cleanTranscript);
      }

      const cleanFinal = finalTranscript.trim();
      if (!cleanFinal) return;

      if (micModeRef.current === "handsfree") {
        if (isHandsFreeCoolingDown() || handsFreeSpeakingRef.current) {
          setIntentText("Ignored: cooldown active");
          return;
        }

        const command = extractWakeWordCommand(cleanFinal);
        setLastCommand(cleanFinal);

        if (!command) {
          setIntentText("Ignored: wake word not detected");
          return;
        }

        setListeningText(command);
        setIntentText(`Lumie heard: ${command}`);
        void runUserCommandRef.current(command);
        return;
      }

      setLastCommand(cleanFinal);
      setListeningText(cleanFinal);
      void runUserCommandRef.current(cleanFinal);
    };

    recognition.onerror = (event) => {
      const error = event.error || "Speech recognition failed.";

      recognitionBusyRef.current = false;
      setMicListening(false);

      if (error === "no-speech") {
        if (micModeRef.current === "push") {
          setMicError("No speech detected. Try again.");
          setIntentText("Ignored: no speech detected");
        }
      } else if (error === "aborted") {
        setMicError("");
      } else {
        setMicError(`Mic error: ${error}`);
        setIntentText(`Ignored: mic error (${error})`);
      }

      if (micModeRef.current === "push") {
        setMicMode("off");
      }
    };

    recognition.onend = () => {
      recognitionBusyRef.current = false;
      setMicListening(false);
      setListeningText("");

      if (micModeRef.current === "push") {
        setMicMode("off");
        recognitionShouldRestartRef.current = false;
        return;
      }

      if (micModeRef.current === "handsfree" && recognitionShouldRestartRef.current) {
        scheduleHandsFreeRestart();
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {}
      recognitionRef.current = null;
      recognitionBusyRef.current = false;
      recognitionShouldRestartRef.current = false;
    };
  }, []);

  async function startPushToTalk() {
    if (!speechSupported) {
      setMicError("Speech recognition is not supported in this browser. Use Chrome.");
      return;
    }

    if (!recognitionRef.current) {
      setMicError("Speech recognition is unavailable.");
      return;
    }

    stopRecognition();
    recognitionShouldRestartRef.current = false;
    setMicMode("push");
    setMicError("");
    setListeningText("");

    window.setTimeout(() => {
      try {
        recognitionBusyRef.current = true;
        recognitionRef.current?.start();
      } catch {
        recognitionBusyRef.current = false;
        setMicMode("off");
        setMicError("Microphone is not available right now. Try again.");
      }
    }, 150);
  }

  async function toggleHandsFree() {
    if (!speechSupported) {
      setMicError("Speech recognition is not supported in this browser. Use Chrome.");
      return;
    }

    if (!recognitionRef.current) {
      setMicError("Speech recognition is unavailable.");
      return;
    }

    if (micMode === "handsfree") {
      setMicMode("off");
      recognitionShouldRestartRef.current = false;
      stopRecognition();
      setListeningText("");
      setMicError("");
      setIntentText("Hands-free off");
      return;
    }

    stopRecognition();
    setMicMode("handsfree");
    recognitionShouldRestartRef.current = true;
    startHandsFreeCooldown(1200);
    setMicError("");
    setListeningText("");
    setIntentText('Hands-free on · say "Lumie ..."');

    window.setTimeout(() => {
      try {
        recognitionBusyRef.current = true;
        recognitionRef.current?.start();
      } catch {
        recognitionBusyRef.current = false;
        setMicMode("off");
        recognitionShouldRestartRef.current = false;
        setMicError("Could not start hands-free mode.");
      }
    }, 150);
  }

  function requestTrackChange(index: number, autoplay = false) {
    if (index < 0 || index >= tracks.length) return;
    pendingAutoplayRef.current = autoplay;
    setCurrentTrackIndex(index);
  }

  function playTrackIndex(index: number, opts?: { autoplay?: boolean }) {
    requestTrackChange(index, !!opts?.autoplay);
  }

  function next(forceAutoplay = false) {
    if (!tracksRef.current.length) return;

    const liveTracks = tracksRef.current;
    const liveCurrentTrackIndex = currentTrackIndexRef.current;
    const autoplay = forceAutoplay || isPlayingRef.current;

    if (shuffleOnRef.current && liveTracks.length > 1) {
      let nextIndex = liveCurrentTrackIndex;

      while (nextIndex === liveCurrentTrackIndex) {
        nextIndex = Math.floor(Math.random() * liveTracks.length);
      }

      requestTrackChange(nextIndex, autoplay);
      return;
    }

    requestTrackChange((liveCurrentTrackIndex + 1) % liveTracks.length, autoplay);
  }

  useEffect(() => {
    if (!playlistAdvanceSignal) return;
    if (playlistAdvanceSignal === lastPlaylistAdvanceSignalRef.current) return;

    lastPlaylistAdvanceSignalRef.current = playlistAdvanceSignal;
    setLoopModeRaw(1);
    next(true);
  }, [playlistAdvanceSignal, setLoopModeRaw]);

  function prev() {
    if (!tracks.length) return;

    if (currentTime > 3) {
      seekTo(0);

      if (!isPlaying) {
        pendingAutoplayRef.current = false;
      }

      return;
    }

    requestTrackChange((currentTrackIndex - 1 + tracks.length) % tracks.length, isPlaying);
  }

  function toggleShuffle() {
    if (tracks.length <= 1) return;

    setShuffleOn((v) => {
      const nextValue = !v;

      setIntentText(nextValue ? "Shuffle on" : "Shuffle off");
      speakReply(nextValue ? "Shuffle on." : "Shuffle off.");

      return nextValue;
    });
  }

  function applyStopInSeconds(sec: number) {
    if (!trackReady) return;

    sleepTimerTargetAtRef.current = null;

    if (sleepTimerTimeoutRef.current) {
      window.clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }

    actions.setStopInSeconds(sec + 1);
    setTimerOpen(false);
    setIntentText(`Stop in ${sec}s`);
    speakReply(`Okay. I will stop in ${sec} seconds.`);
  }

  function applyStopAtCurrentTrackPosition() {
    if (!trackReady) return;

    const raw = stopAtInput.trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return;

    const mm = Number(match[1]);
    const ss = Number(match[2]);
    const total = mm * 60 + ss;

    actions.setStopAtTrack(total);
    setTimerOpen(false);
    setIntentText(`Stop at ${fmtTime(total)}`);
    speakReply(`Okay. I will stop at ${fmtTime(total)}.`);
  }

  function applyStopAfterLoopCycle() {
    if (!trackReady) return;
    const ok = actions.setStopAfterLoopCycle();
    setTimerOpen(false);

    if (ok) {
      setIntentText("Stop at end of loop");
      speakReply("Okay. I will stop at the end of the loop.");
    } else {
      setIntentText("End-of-loop timer unavailable");
      speakReply("That timer is not available in infinity loop mode.");
    }
  }

  function cancelTimer() {
    sleepTimerTargetAtRef.current = null;

    if (sleepTimerTimeoutRef.current) {
      window.clearTimeout(sleepTimerTimeoutRef.current);
      sleepTimerTimeoutRef.current = null;
    }

    actions.cancelStop();
    setTimerOpen(false);
    setIntentText("Timer cancelled");
    speakReply("Timer cancelled.");
  }

  useEffect(() => {
    if (stop.rule.type !== "in") {
      sleepTimerTargetAtRef.current = null;

      if (sleepTimerTimeoutRef.current) {
        window.clearTimeout(sleepTimerTimeoutRef.current);
        sleepTimerTimeoutRef.current = null;
      }

      return;
    }

    if (!isPlaying) return;

    if (!sleepTimerTargetAtRef.current) {
      sleepTimerTargetAtRef.current = Date.now() + Math.max(1, stop.rule.remainingSec) * 1000;
    }

    if (sleepTimerTimeoutRef.current) {
      window.clearTimeout(sleepTimerTimeoutRef.current);
    }

    const delay = Math.max(0, sleepTimerTargetAtRef.current - Date.now());

    sleepTimerTimeoutRef.current = window.setTimeout(() => {
      pause();
      actions.cancelStop();
      sleepTimerTargetAtRef.current = null;
      sleepTimerTimeoutRef.current = null;
      setIntentText("Playback stopped");
    }, delay);

    return () => {
      if (sleepTimerTimeoutRef.current) {
        window.clearTimeout(sleepTimerTimeoutRef.current);
        sleepTimerTimeoutRef.current = null;
      }
    };
  }, [stop.rule, isPlaying, pause, actions]);

  useEffect(() => {
    if (!activeSrc || !pendingAutoplayRef.current) return;

    const id = window.setTimeout(() => {
      void actions.play();
      pendingAutoplayRef.current = false;
    }, 120);

    return () => window.clearTimeout(id);
  }, [activeSrc, actions]);

  useEffect(() => {
    if (currentTrackIndex >= tracks.length && tracks.length > 0) {
      setCurrentTrackIndex(0);
    }
  }, [tracks, currentTrackIndex]);

  useEffect(() => {
    return () => {
      for (const url of uploadedBlobUrlsRef.current) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
      stopRecognition();
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const currentSyncedLines = useMemo(() => {
    if (!currentLyricsState.isSynced || !currentLyricsState.lyrics) return [];
    return parseLrc(currentLyricsState.lyrics);
  }, [currentLyricsState.isSynced, currentLyricsState.lyrics]);

  const hasTimestampedLyrics =
    currentLyricsState.isSynced && currentSyncedLines.length >= 2;

  const isReliableSyncedLyrics =
    hasTimestampedLyrics && hasReasonableTimingSpread(currentSyncedLines);

  const syncedActiveIndex = useMemo(() => {
    if (!currentSyncedLines.length) return -1;

    const adjustedTime = Math.max(0, (currentTime ?? 0) - lyricsOffset);

    return findActiveIndex(currentSyncedLines, adjustedTime);
  }, [currentSyncedLines, currentTime, lyricsOffset]);

  const livePreview = useMemo(() => {
    if (isReliableSyncedLyrics) {
      const active = syncedActiveIndex;

      if (active < 0) {
        return currentSyncedLines.slice(0, 3).map((l, i) => ({
          idx: i,
          t: l.t,
          text: l.text?.trim() || "…",
          active: false,
        }));
      }

      const start = Math.max(0, active - 1);
      const end = Math.min(currentSyncedLines.length, start + 3);
      const slice = currentSyncedLines.slice(start, end);

      return slice.map((l, offset) => {
        const idx = start + offset;
        return {
          idx,
          t: l.t,
          text: l.text?.trim() || "…",
          active: idx === active,
        };
      });
    }

    return pickPreviewLines(currentLyricsState.lyrics || "", 3).map((text, i) => ({
      idx: i,
      t: 0,
      text,
      active: false,
    }));
  }, [
    isReliableSyncedLyrics,
    currentLyricsState.lyrics,
    currentSyncedLines,
    syncedActiveIndex,
  ]);

  useEffect(() => {
    // Auto-scroll is intentionally disabled because provider timestamps can be imperfect.
    // The active line still highlights, and users can tap a synced line to jump.
    return;
  }, [lyricsOpen, isReliableSyncedLyrics, syncedActiveIndex]);

  useEffect(() => {
    if (!lyricsOpen) return;
    setLyricsEditMode(false);
    setLyricsSearchEditOpen(false);
    setLyricsManualDraft(currentLyricsState.lyrics ?? "");
    setLyricsSearchTitleDraft(clean(effectiveTitleArtist.title));
    setLyricsSearchArtistDraft(clean(effectiveTitleArtist.artist));
  }, [lyricsOpen, trackId, currentLyricsState.lyrics, effectiveTitleArtist.title, effectiveTitleArtist.artist]);

  useEffect(() => {
    setLyricsOffset(0.6);
  }, [trackId]);

  useEffect(() => {
    if (!trackId) return;

    const title = clean(effectiveTitleArtist.title);
    if (!title) return;

    if (lyricsAutoFetchRef.current[trackId]) return;

    lyricsAutoFetchRef.current[trackId] = true;
    void fetchLyrics("auto");
  }, [trackId, effectiveTitleArtist.title]);

  async function fetchLyrics(mode: "auto" | "reset" = "auto") {
    const liveTrackId = currentTrackRef.current?.id ?? 0;
    if (!liveTrackId) return;

    const { title, artist } = getBetterLyricsLookup(
      currentTrackRef.current?.title || effectiveTitleArtist.title,
      currentTrackRef.current?.artist || effectiveTitleArtist.artist,
      currentTrackRef.current?.fileLabel
    );

    if (mode === "reset") {
      lyricsAutoFetchRef.current[liveTrackId] = false;
      setLyricsByTrackId((m) => ({
        ...m,
        [liveTrackId]: { provider: "none", lyrics: "", isSynced: false },
      }));
      setLyricsStatus("idle");
      return;
    }

    setLyricsStatus("loading");
    setLyricsByTrackId((m) => ({
      ...m,
      [liveTrackId]: {
        ...(m[liveTrackId] ?? { provider: "none", lyrics: "", isSynced: false }),
        error: undefined,
      },
    }));

    try {
      const qs = new URLSearchParams();
      qs.set("title", title || "");
      qs.set("artist", artist || "");

      const res = await fetch(`/api/lyrics?${qs.toString()}`, { method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Lyrics API failed: ${res.status} ${text || ""}`.trim());
      }

      const data = (await res.json()) as { lyrics?: string; provider?: string };
      const lyricsText = String(data.lyrics ?? "");
      const provider = (data.provider ?? "none") as LyricsProvider;
      const isSynced = hasLrc(lyricsText);

      setLyricsByTrackId((m) => ({
        ...m,
        [liveTrackId]: {
          provider,
          lyrics: lyricsText,
          isSynced,
          fetchedAt: Date.now(),
        },
      }));

      setLyricsStatus("ok");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to fetch lyrics";
      setLyricsByTrackId((m) => ({
        ...m,
        [liveTrackId]: {
          ...(m[liveTrackId] ?? { provider: "none", lyrics: "", isSynced: false }),
          error: message,
          fetchedAt: Date.now(),
        },
      }));
      setLyricsStatus("err");
    }
  }

  function saveLyricsSearchMetadata() {
    if (!trackId) return false;

    const nextTitle = clean(lyricsSearchTitleDraft);
    const nextArtist = clean(lyricsSearchArtistDraft);

    if (!nextTitle) return false;

    setTracks((prev) =>
      prev.map((track) =>
        track.id === trackId
          ? {
              ...track,
              title: nextTitle,
              artist: nextArtist,
            }
          : track
      )
    );

    currentTrackRef.current =
      currentTrackRef.current && currentTrackRef.current.id === trackId
        ? {
            ...currentTrackRef.current,
            title: nextTitle,
            artist: nextArtist,
          }
        : currentTrackRef.current;

    return true;
  }

  async function applyLyricsSearchMetadataAndRetry() {
    const ok = saveLyricsSearchMetadata();
    if (!ok) return;

    lyricsAutoFetchRef.current[trackId] = false;
    setLyricsSearchEditOpen(false);
    await fetchLyrics("auto");
  }

  function saveManualLyrics() {
    if (!trackId) return;
    setLyricsByTrackId((m) => ({
      ...m,
      [trackId]: {
        provider: "manual",
        lyrics: lyricsManualDraft,
        isSynced: hasLrc(lyricsManualDraft),
        fetchedAt: Date.now(),
      },
    }));
    setLyricsEditMode(false);
    speakReply("Lyrics updated.");
  }

  function getBetterLyricsLookup(title?: string, artist?: string, fileLabel?: string) {
    const cleanTitle = clean(title);
    const cleanArtist = clean(artist);

    if (cleanTitle && cleanArtist) {
      return { title: cleanTitle, artist: cleanArtist };
    }

    const guessed = guessTitleArtistFromLabel(fileLabel);
    return {
      title: cleanTitle || guessed.title || "",
      artist: cleanArtist || guessed.artist || "",
    };
  }

  function onUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const nextTracks: Track[] = [];
    let baseId = Date.now();

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const url = URL.createObjectURL(f);
      uploadedBlobUrlsRef.current.push(url);

      const label = f.name;
      const guess = guessTitleArtistFromLabel(label);

      nextTracks.push({
        id: baseId + i,
        title: prettifyTitle(guess.title || label),
        artist: prettifyTitle(guess.artist || ""),
        fileLabel: label,
        src: url,
        kind: "upload",
      });
    }

    const startIndex = tracksRef.current.length;
    setTracks((prev) => [...prev, ...nextTracks]);

    if (nextTracks.length > 0) {
      pendingAutoplayRef.current = true;
      setCurrentTrackIndex(startIndex);
      setIntentText(`Added ${nextTracks.length} track${nextTracks.length === 1 ? "" : "s"}`);
      speakReply(
        `Added ${nextTracks.length} track${nextTracks.length === 1 ? "" : "s"} to the playlist.`
      );
    }
  }

  async function processCommand(
    input: string,
    source: "typed" | "push" | "handsfree"
  ) {
    const cmd = input.trim();
    if (!cmd) return;

    const liveTracks = tracksRef.current;
    const liveCurrentTrackIndex = currentTrackIndexRef.current;
    const liveCurrentTrack = currentTrackRef.current;
    const liveIsPlaying = isPlayingRef.current;
    const liveCurrentTime = currentTimeRef.current;
    const liveDuration = durationRef.current;
    const liveShuffleOn = shuffleOnRef.current;
    const liveStopRule = stopRuleRef.current;

    setLastCommand(cmd);

    if (shouldClearExistingTimerForNewCommand(cmd) && liveStopRule.type !== "none") {
      actions.cancelStop();
    }

    const ctx: CommandContext = {
      tracks: liveTracks,
      currentTrackIndex: liveCurrentTrackIndex,
      currentTrackId: liveCurrentTrack?.id,

      isPlaying: liveIsPlaying,
      currentTime: liveCurrentTime,
      duration: liveDuration,

      play: async () => {
        await play();
      },
      pause,
      togglePlay: toggle,
      stop: pause,

      next,
      prev,

      seekBy,
      seekTo,

      playTrackIndex,

      shuffleOn: liveShuffleOn,
      setShuffle: (on: boolean) => setShuffleOn(on),

      setLoopMode: (mode: LoopMode) => {
        if (mode === "1x") setLoopModeRaw(1);
        else if (mode === "2x") setLoopModeRaw(2);
        else if (mode === "3x") setLoopModeRaw(3);
        else setLoopModeRaw("infinity");
      },

      setSleepTimerInSeconds: (seconds: number) => actions.setStopInSeconds(seconds + 1),
      setSleepTimerAtSeconds: actions.setStopAtTrack,
      cancelSleepTimer: actions.cancelStop,

      toggleLikeTrackId: (id: number) => {
        setLiked((m) => ({ ...m, [id]: !m[id] }));
      },

      openPlaylist: () => setPlaylistOpen(true),
      closePlaylist: () => setPlaylistOpen(false),

      openLyrics: () => setLyricsOpen(true),
      closeLyrics: () => setLyricsOpen(false),
      fetchLyrics: () => {
        const liveTrackId = currentTrackRef.current?.id ?? 0;
        if (!liveTrackId) return;
        lyricsAutoFetchRef.current[liveTrackId] = false;
        void fetchLyrics("auto");
      },

      openProfile: () => setProfileOpen(true),
      closeProfile: () => setProfileOpen(false),
    };

    const resultText = await runCommand(cmd, ctx);
    const finalText = resultText || "—";

    if (source === "handsfree") {
      startHandsFreeCooldown(2800);
    }

    setIntentText(finalText);
    pushCommandHistory(cmd, finalText, source);
    speakReply(finalText || cmd);
  }

  async function runUserCommand(input: string) {
    const cmd = input.trim();
    if (!cmd) {
      setIntentText("Ignored: no final command recognized");
      return;
    }

    const source = getCommandSource(micModeRef.current, cmd);

    if (commandRunningRef.current) {
      pendingCommandRef.current = { input: cmd, source };
      setIntentText("Command queued");
      return;
    }

    commandRunningRef.current = true;
    setCommandProcessing(true);

    try {
      await processCommand(cmd, source);
    } finally {
      commandRunningRef.current = false;

      if (pendingCommandRef.current) {
        const nextPending = pendingCommandRef.current;
        pendingCommandRef.current = null;

        commandRunningRef.current = true;
        try {
          await processCommand(nextPending.input, nextPending.source);
        } finally {
          commandRunningRef.current = false;
        }
      }

      setCommandProcessing(false);
    }
  }

  runUserCommandRef.current = runUserCommand;

  const isLiked = !!liked[trackId];
  const oneTrackOnly = tracks.length <= 1;
  const noTrack = tracks.length === 0;
  const trackReady = isReady && duration > 0;

  const providerBadge = isReliableSyncedLyrics
    ? "Timed"
    : currentLyricsState.lyrics
      ? "Lyrics"
      : "Not found";

  const providerLabel =
    currentLyricsState.provider === "lrclib_synced"
      ? "lrclib_synced"
      : currentLyricsState.provider === "lrclib_plain"
        ? "lrclib_plain"
        : currentLyricsState.provider === "lyrics_ovh_plain"
          ? "lyrics_ovh_plain"
          : currentLyricsState.provider === "manual"
            ? "manual"
            : "none";

  const loopText = loopMode === "infinity" ? "∞" : `${loopMode}x`;

  const stopText =
    stop.rule.type === "none"
      ? "Off"
      : stop.rule.type === "in"
        ? `In ${stop.rule.remainingSec}s`
        : stop.rule.type === "at"
          ? `At ${fmtTime(stop.rule.atSec)}`
          : "End loop";

  const timerVisiblyActive = !(
    stop.rule.type === "in" &&
    !isPlaying &&
    stop.rule.remainingSec <= 1
  );

  const showTimerStatus = stop.rule.type !== "none" && timerVisiblyActive;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-[420px] px-4 pb-10 pt-8">
        <div className="flex items-center justify-between">

          <div className="flex flex-col">
            <div className="text-lg font-bold tracking-tight text-white">
              Lumie
            </div>

            <div className="text-[11px] leading-tight text-white/50">
              Smart looping music player with voice control
            </div>
          </div>

          <button
            className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
            type="button"
            title="Profile"
            onClick={() => setProfileOpen(true)}
          >
            <User className="h-5 w-5 text-white/70" />
          </button>
        </div>

        <div className="mt-6 rounded-[28px] border border-white/10 bg-gradient-to-b from-white/5 to-white/[0.02] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
          <div className="flex items-center gap-4">
            <div className="relative h-[86px] w-[86px] shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/10 via-white/0 to-emerald-500/10" />
              <div className="pointer-events-none absolute inset-0 backdrop-blur-[2px]" />
              <div className="pointer-events-none absolute left-3 top-3 opacity-70">
                <Music2 className="h-5 w-5 text-white/70" />
              </div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-semibold">
                {effectiveTitleArtist.title || "No track selected"}
              </div>
              <div className="truncate text-sm text-white/60">
                {effectiveTitleArtist.artist || "Unknown artist"}
              </div>
              <div className="mt-1 text-xs text-white/40">
                Track {tracks.length ? currentTrackIndex + 1 : 0} · Loop: {loopText} ·{" "}
                {isPlaying ? "Playing" : "Paused"}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!trackId) return;
                setLiked((m) => ({ ...m, [trackId]: !m[trackId] }));
              }}
              className="rounded-full border border-white/10 bg-white/5 p-2 hover:bg-white/10"
              title={isLiked ? "Unlike" : "Like"}
            >
              <Heart
                className={`h-5 w-5 ${
                  isLiked ? "fill-emerald-400 text-emerald-400" : "text-white/70"
                }`}
              />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] text-white/70">

  {showTimerStatus && (
    <span className="whitespace-nowrap text-emerald-300 animate-pulse">
      {stop.rule.type === "in" && `⏱ Stops in ${Math.max(0, stop.rule.remainingSec)}s`}
      {stop.rule.type === "at" && `⏱ Stops at ${fmtTime(stop.rule.atSec)}`}
      {stop.rule.type === "endLoop" && "⏱ Stops after loop"}
    </span>
  )}

  {micMode === "handsfree" && (
    <span className="whitespace-nowrap text-emerald-200">
      {handsFreeStateText === "Listening"
        ? "Listening..."
        : handsFreeStateText === "Speaking"
        ? "Responding..."
        : handsFreeStateText}
    </span>
  )}

  {loopMode !== 1 && (
    <span className="whitespace-nowrap text-white/50">
      Looping {loopMode === "infinity" ? "∞" : `${loopMode}x`}
    </span>
  )}

  {showTimerStatus && (
    <button
      type="button"
      onClick={cancelTimer}
      className="ml-2 text-[11px] text-emerald-300 underline underline-offset-2 hover:text-emerald-200"
    >
      Cancel
    </button>
  )}
</div>

          <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
            <div className="text-xs text-white/50">
              <span className="font-semibold text-white/60">You said:</span>{" "}
              {listeningText || lastCommand || "—"}
            </div>
            <div className="mt-2 text-xs text-white/85">
              {commandProcessing ? "Processing..." : intentText || "—"}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/70">
                {micListening
                  ? micMode === "handsfree"
                    ? "Mic: Lumie listening"
                    : "Mic: Listening"
                  : "Mic: Off"}
              </span>

              <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/70">
                {voiceReplyOn ? "Voice reply on" : "Voice reply off"}
              </span>

              <button
                type="button"
                onClick={() => {
                  void startPushToTalk();
                }}
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/70 hover:bg-black/40"
              >
                <Mic className="mr-1 inline h-3.5 w-3.5" />
                Push-to-talk
              </button>

              <button
                type="button"
                onClick={() => {
                  void toggleHandsFree();
                }}
                className={`rounded-full border px-3 py-1 text-[11px] ${
                  micMode === "handsfree"
                    ? "border-emerald-400/30 bg-emerald-500/20 text-white"
                    : "border-white/10 bg-black/30 text-white/70 hover:bg-black/40"
                }`}
              >
                <Sparkles className="mr-1 inline h-3.5 w-3.5" />
                Hands-free Lumie
              </button>

              <button
                type="button"
                onClick={() => {
                  const next = !voiceReplyOn;
                  setVoiceReplyOn(next);
                  if (!next && "speechSynthesis" in window) {
                    window.speechSynthesis.cancel();
                    handsFreeSpeakingRef.current = false;
                    setVoiceReplyStatus("");
                  }
                }}
                className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/70 hover:bg-black/40"
              >
                <BookOpenText className="mr-1 inline h-3.5 w-3.5" />
                Voice reply
              </button>
            </div>

            {micError ? (
              <div className="mt-2 text-[11px] leading-snug text-red-200">{micError}</div>
            ) : voiceReplyStatus ? (
              <div className="mt-2 text-[11px] leading-snug text-emerald-200">{voiceReplyStatus}</div>
            ) : (
              <div className="mt-2 text-[11px] leading-snug text-white/50">
                Push-to-talk listens once. Hands-free listens continuously, waits for “Lumie”, uses cooldown to avoid double triggers, and queues fast follow-up commands.
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-white/50">
              <span>{fmtTime(currentTime)}</span>
              <span>{fmtTime(duration)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(duration || 1))}
              value={Math.floor(currentTime || 0)}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="mt-2 w-full accent-emerald-400"
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={prev}
              disabled={oneTrackOnly}
              className={`rounded-full border p-3 ${
                oneTrackOnly
                  ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              title={oneTrackOnly ? "Need 2+ tracks" : "Previous"}
            >
              <SkipBack className="h-5 w-5 text-white/80" />
            </button>

            <button
              type="button"
              onClick={() => seekBy(-10)}
              disabled={!trackReady}
              className={`rounded-full border p-3 ${
                !trackReady
                  ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              title="-10s"
            >
              <Minus className="h-5 w-5 text-white/80" />
            </button>

            <button
              type="button"
              onClick={toggle}
              disabled={noTrack}
              className={`rounded-full border p-4 shadow-[0_10px_40px_rgba(16,185,129,0.15)] ${
                noTrack
                  ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                  : "border-emerald-500/30 bg-emerald-500/20 hover:bg-emerald-500/25"
              }`}
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <Pause className="h-6 w-6 text-white" />
              ) : (
                <Play className="h-6 w-6 text-white" />
              )}
            </button>

            <button
              type="button"
              onClick={() => seekBy(10)}
              disabled={!trackReady}
              className={`rounded-full border p-3 ${
                !trackReady
                  ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              title="+10s"
            >
              <Plus className="h-5 w-5 text-white/80" />
            </button>

            <button
              type="button"
              onClick={next}
              disabled={oneTrackOnly}
              className={`rounded-full border p-3 ${
                oneTrackOnly
                  ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                  : "border-white/10 bg-white/5 hover:bg-white/10"
              }`}
              title={oneTrackOnly ? "Need 2+ tracks" : "Next"}
            >
              <SkipForward className="h-5 w-5 text-white/80" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="mr-2 text-xs text-white/60">Loop</div>

            {([1, 2, 3, "infinity"] as const).map((m) => (
              <button
                key={String(m)}
                type="button"
                onClick={() => {
                  setLoopModeRaw(m);

                  const label = m === "infinity" ? "infinity" : `${m}x`;
                  setIntentText(`Loop ${label}`);
                  speakReply(`Loop set to ${label}.`);
                }}
                disabled={noTrack}
                className={`rounded-full border px-3 py-1 text-xs ${
                  noTrack
                    ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/40"
                    : loopMode === m
                      ? "border-emerald-400/40 bg-emerald-500/20 text-white"
                      : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                }`}
              >
                {m === "infinity" ? "∞" : `${m}x`}
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={toggleShuffle}
                disabled={oneTrackOnly}
                className={`rounded-full border p-2 ${
                  oneTrackOnly
                    ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                    : shuffleOn
                      ? "border-emerald-400/40 bg-emerald-500/20"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
                title={oneTrackOnly ? "Need 2+ tracks" : "Shuffle"}
              >
                <Shuffle className="h-4 w-4 text-white/80" />
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!trackReady) return;
                  setTimerOpen(true);
                }}
                disabled={!trackReady}
                className={`rounded-full border p-2 ${
                  !trackReady
                    ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                    : showTimerStatus
                      ? "border-yellow-400/30 bg-yellow-500/10"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
                title={trackReady ? "Timer" : "Wait for track to finish loading"}
              >
                <Timer className="h-4 w-4 text-white/80" />
              </button>

              <button
                type="button"
                onClick={() => setPlaylistOpen(true)}
                disabled={noTrack}
                className={`rounded-full border p-2 ${
                  noTrack
                    ? "cursor-not-allowed border-white/5 bg-white/[0.03] opacity-50"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
                title="Playlist"
              >
                <ListMusic className="h-4 w-4 text-white/80" />
              </button>
            </div>
          </div>

          {(!trackReady || oneTrackOnly || showTimerStatus) && (
            <div className="mt-3 text-[11px] text-white/45">
              {!trackReady ? "Wait for audio metadata to load before using timer or seek controls. " : ""}
              {oneTrackOnly
                ? "Upload 2 or more songs to fully test Next, Previous, Shuffle, and Playlist. "
                : ""}
              {showTimerStatus
                ? "Sleep timer is active. Playback may stop automatically."
                : ""}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <input
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void runUserCommand(commandInput);
                  setCommandInput("");
                }
              }}
              placeholder='Type a command: "play track 4 and stop in 1m"'
              className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 placeholder:text-white/30 outline-none focus:border-emerald-400/30"
            />
            <button
              type="button"
              onClick={() => {
                void runUserCommand(commandInput);
                setCommandInput("");
              }}
              className="rounded-2xl border border-emerald-400/30 bg-emerald-500/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500/25"
            >
              Run
            </button>
          </div>

          <button
            type="button"
            onClick={() => setQuickOpen((v) => !v)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div>
              <div className="text-sm font-semibold">Quick commands</div>
              <div className="text-xs text-white/50">Starter actions for first-time users.</div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-white/60 transition ${quickOpen ? "rotate-180" : ""}`}
            />
          </button>

          {quickOpen && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {[
                "Play",
                "Pause",
                "Next",
                "Previous",
                "Loop 2x",
                "Loop infinity",
                "Shuffle on",
                "Open lyrics",
                "Open playlist",
              ].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    void runUserCommand(q);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
          >
            <div>
              <div className="text-sm font-semibold">Command history</div>
              <div className="text-xs text-white/50">
                Recent typed and voice interactions
              </div>
            </div>

            <div className="flex items-center gap-2">
              {commandHistory.length > 0 && (
                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-white/60">
                  {commandHistory.length}
                </span>
              )}

              <ChevronDown
                className={`h-4 w-4 text-white/60 transition ${historyOpen ? "rotate-180" : ""}`}
              />
            </div>
          </button>

          {historyOpen && (
            <div className="mt-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-white/45">
                  Review the most recent commands Lumie executed
                </div>

                {commandHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCommandHistory([])}
                    className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70 hover:bg-black/30"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="mt-3">
                {commandHistory.length === 0 ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/45">
                    No commands yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commandHistory.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-white/10 bg-black/20 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/60">
                            {item.source}
                          </span>
                          <span className="text-[11px] text-white/40">
                            {formatHistoryTime(item.createdAt)}
                          </span>
                        </div>

                        <div className="mt-2 text-xs text-white/50">
                          <span className="font-semibold text-white/60">You said:</span>{" "}
                          {item.command}
                        </div>

                        <div className="mt-1 text-xs text-emerald-200/90">
                          <span className="font-semibold text-emerald-100">Lumie did:</span>{" "}
                          {item.result}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">Lyrics</div>

                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    currentLyricsState.isSynced
                      ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                      : currentLyricsState.lyrics
                        ? "border-white/10 bg-white/5 text-white/60"
                        : "border-yellow-400/30 bg-yellow-500/10 text-yellow-200"
                  }`}
                >
                  {providerBadge}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const liveTrackId = currentTrackRef.current?.id ?? 0;
                    if (!liveTrackId) return;
                    lyricsAutoFetchRef.current[liveTrackId] = false;
                    void fetchLyrics("auto");
                  }}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70 hover:bg-black/30"
                >
                  <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
                  Retry
                </button>

                <button
                  type="button"
                  onClick={() => setLyricsOpen(true)}
                  className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/70 hover:bg-black/30"
                >
                  <BookOpenText className="mr-1 inline h-3.5 w-3.5" />
                  Open
                </button>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              {livePreview.length ? (
                <div className="space-y-1">
                  {livePreview.map((l, i) => {
                    const clickable = isReliableSyncedLyrics;
                    return (
                      <button
                        key={`${l.idx}-${l.t}-${i}`}
                        type="button"
                        onClick={() => {
                          if (!clickable) return;
                          if (!trackReady) return;
                          preventAutoScrollUntilRef.current = Date.now() + 900;
                          seekTo(l.t);
                          window.setTimeout(() => {
                            if (!isPlayingRef.current) void play();
                          }, 80);
                        }}
                        className={`block w-full text-left ${
                          clickable ? "cursor-pointer" : "cursor-default"
                        }`}
                      >
                        <div
                          className={`truncate text-sm ${
                            l.active ? "font-semibold text-white" : "text-white/55"
                          } ${clickable ? "hover:text-white/80" : ""}`}
                        >
                          {l.text}
                        </div>
                      </button>
                    );
                  })}

                  {isReliableSyncedLyrics && (
                    <div className="pt-1 text-[11px] text-emerald-200/70">
                      Tap a line to jump
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-white/50">
                  {lyricsStatus === "loading"
                    ? "Loading lyrics..."
                    : "Lyrics not found. Retry or fix title/artist in the Lyrics panel."}
                </div>
              )}
            </div>

            <div className="mt-2 text-[11px] text-white/45">Source: {providerLabel}</div>
          </div>

          <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70 hover:bg-white/10">
            <Upload className="h-4 w-4" />
            Upload audio (mp3/wav) — optional
            <input
              type="file"
              accept="audio/*"
              multiple
              className="hidden"
              onChange={(e) => onUploadFiles(e.target.files)}
            />
          </label>
        </div>
      </div>

      <Sheet
        open={playlistOpen}
        title="Playlist"
        subtitle={`${tracks.length} track${tracks.length === 1 ? "" : "s"}`}
        onClose={() => setPlaylistOpen(false)}
      >
        <div className="rounded-2xl border border-white/10 bg-black/20 p-2">
          <div className="space-y-2">
            {tracks.map((track, index) => {
              const active = index === currentTrackIndex;
              const likedTrack = !!liked[track.id];
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => {
                    playTrackIndex(index, { autoplay: true });
                    setPlaylistOpen(false);
                    speakReply(`Playing ${track.title}`);
                  }}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition ${
                    active
                      ? "bg-emerald-500/15 ring-1 ring-emerald-400/20"
                      : "hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                    {active && isPlaying ? (
                      <Pause className="h-4 w-4 text-white" />
                    ) : (
                      <Music2 className="h-4 w-4 text-white/70" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm ${active ? "font-semibold text-white" : "text-white/85"}`}>
                      {track.title}
                    </div>
                    <div className="truncate text-xs text-white/50">
                      {track.artist || "Unknown artist"} · {track.kind === "upload" ? "Uploaded" : "Demo"}
                    </div>
                  </div>

                  {likedTrack && (
                    <Heart className="h-4 w-4 fill-emerald-400 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Sheet>

      <Sheet
        open={timerOpen && !noTrack}
        title="Sleep timer"
        subtitle="Choose when playback should stop"
        onClose={() => setTimerOpen(false)}
      >
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => applyStopInSeconds(30)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
            >
              Stop in 30s
            </button>

            <button
              type="button"
              onClick={() => applyStopInSeconds(60)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
            >
              Stop in 1m
            </button>

            <button
              type="button"
              onClick={() => applyStopInSeconds(300)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
            >
              Stop in 5m
            </button>

            <button
              type="button"
              onClick={() => applyStopInSeconds(600)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
            >
              Stop in 10m
            </button>
          </div>

          <button
            type="button"
            onClick={applyStopAfterLoopCycle}
            disabled={loopMode === "infinity" || !trackReady}
            className={`mt-3 w-full rounded-xl border px-3 py-2 text-xs ${
              loopMode === "infinity" || !trackReady
                ? "cursor-not-allowed border-white/5 bg-white/[0.03] text-white/35"
                : "border-white/10 bg-white/5 text-white/75 hover:bg-white/10"
            }`}
          >
            Stop at end of loop
          </button>

          <div className="mt-3">
            <div className="mb-1 text-[11px] text-white/45">
              Stop at track time (mm:ss)
            </div>
            <div className="flex gap-2">
              <input
                value={stopAtInput}
                onChange={(e) => setStopAtInput(e.target.value)}
                placeholder="02:15"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 outline-none focus:border-emerald-400/30"
              />
              <button
                type="button"
                onClick={applyStopAtCurrentTrackPosition}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
              >
                Set
              </button>
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 text-[11px] text-white/45">
              Custom minutes
            </div>
            <div className="flex gap-2">
              <input
                value={customTimerMin}
                onChange={(e) => setCustomTimerMin(e.target.value)}
                placeholder="10"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/80 outline-none focus:border-emerald-400/30"
              />
              <button
                type="button"
                onClick={() => {
                  const mins = Number(customTimerMin);
                  if (!Number.isFinite(mins) || mins <= 0) return;
                  applyStopInSeconds(Math.floor(mins * 60));
                }}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/75 hover:bg-white/10"
              >
                Apply
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={cancelTimer}
            className="mt-3 w-full rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:bg-red-500/15"
          >
            Cancel timer
          </button>
        </div>
      </Sheet>

      <Sheet
        open={lyricsOpen}
        title="Lyrics"
        subtitle={`${effectiveTitleArtist.title}${effectiveTitleArtist.artist ? ` - ${effectiveTitleArtist.artist}` : ""}`}
        onClose={() => setLyricsOpen(false)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              currentLyricsState.isSynced
                ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                : currentLyricsState.lyrics
                  ? "border-white/10 bg-white/5 text-white/60"
                  : "border-yellow-400/30 bg-yellow-500/10 text-yellow-200"
            }`}
          >
            {providerBadge}
          </span>

          <div className="min-w-0 text-[11px] text-white/45">
            Make sure the song title and artist are correct
          </div>

          <button
            type="button"
            onClick={() => {
              setLyricsSearchEditOpen((v) => !v);
              setLyricsSearchTitleDraft(clean(effectiveTitleArtist.title));
              setLyricsSearchArtistDraft(clean(effectiveTitleArtist.artist));
            }}
            className="ml-auto rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            <Pencil className="mr-1 inline h-3.5 w-3.5" />
            Fix song details
          </button>

          <button
            type="button"
            onClick={() => {
              const liveTrackId = currentTrackRef.current?.id ?? 0;
              if (!liveTrackId) return;
              lyricsAutoFetchRef.current[liveTrackId] = false;
              void fetchLyrics("auto");
            }}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
          >
            {lyricsStatus === "loading" ? (
              "Loading..."
            ) : (
              <>
                <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
                Try again
              </>
            )}
          </button>

        </div>

        {lyricsSearchEditOpen && (
          <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-xs font-semibold text-white/80">Fix song details for lyrics search</div>
            <div className="mt-1 text-[11px] leading-snug text-white/45">
              Uploaded songs often need a clean title and artist before lyrics providers can find a match.
            </div>

            <div className="mt-3 grid gap-2">
              <input
                value={lyricsSearchTitleDraft}
                onChange={(e) => setLyricsSearchTitleDraft(e.target.value)}
                placeholder="Song title"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-emerald-400/30"
              />
              <input
                value={lyricsSearchArtistDraft}
                onChange={(e) => setLyricsSearchArtistDraft(e.target.value)}
                placeholder="Artist name"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 outline-none focus:border-emerald-400/30"
              />
            </div>

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setLyricsSearchEditOpen(false)}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void applyLyricsSearchMetadataAndRetry();
                }}
                className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500/25"
              >
                Save and retry
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
          {lyricsEditMode ? (
            <>
              <textarea
                value={lyricsManualDraft}
                onChange={(e) => setLyricsManualDraft(e.target.value)}
                className="h-[240px] w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/80 outline-none focus:border-emerald-400/30"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setLyricsEditMode(false)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveManualLyrics}
                  className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500/25"
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              {isReliableSyncedLyrics && (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-white/60">
                  <span className="text-white/50">Sync</span>

                  <button
                    type="button"
                    onClick={() => setLyricsOffset((prev) => Math.max(-2, Number((prev - 0.2).toFixed(1))))}
                    className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/10"
                    title="Highlight earlier"
                  >
                    −
                  </button>

                  <span className="w-12 text-center text-white/80">
                    {lyricsOffset.toFixed(1)}s
                  </span>

                  <button
                    type="button"
                    onClick={() => setLyricsOffset((prev) => Math.min(2, Number((prev + 0.2).toFixed(1))))}
                    className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/10"
                    title="Highlight later"
                  >
                    +
                  </button>

                  <button
                    type="button"
                    onClick={() => setLyricsOffset(0.6)}
                    className="ml-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/10"
                  >
                    Reset
                  </button>
                </div>
              )}

              {isReliableSyncedLyrics ? (
                <div
                  ref={lyricsScrollRef}
                  className="h-[280px] overflow-y-auto pr-2"
                  onScroll={() => {
                    preventAutoScrollUntilRef.current = Date.now() + 1200;
                  }}
                >
                  <div className="space-y-2 py-2">
                    {currentSyncedLines.map((ln, idx) => {
                      const active = idx === syncedActiveIndex;

                      return (
                        <button
                          key={`${ln.t}-${idx}`}
                          type="button"
                          data-lrc-idx={idx}
                          onClick={() => {
                            if (!trackReady) return;
                            preventAutoScrollUntilRef.current = Date.now() + 1200;
                            seekTo(ln.t);
                            window.setTimeout(() => {
                              if (!isPlayingRef.current) void play();
                            }, 80);
                          }}
                          className="block w-full text-left"
                          title={`Jump to ${fmtTime(ln.t)}`}
                        >
                          <div
                            className={`rounded-xl px-2 py-1 text-sm leading-relaxed transition ${
                              active
                                ? "bg-emerald-500/15 font-semibold text-white ring-1 ring-emerald-400/20"
                                : "text-white/45 hover:bg-white/[0.06] hover:text-white/70"
                            }`}
                          >
                            {ln.text || "…"}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : currentLyricsState.lyrics ? (
                <div className="h-[280px] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/20 p-4 text-sm leading-relaxed text-white/70">
                  {currentLyricsState.lyrics}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                  <div className="text-sm font-semibold text-white/90">
                    Lyrics not found
                  </div>

                  <div className="mt-2 text-sm leading-relaxed text-white/60">
                    This track may not be recognized. Try fixing the title and artist, then retry.
                  </div>
                </div>
              )}

              {isReliableSyncedLyrics && (
                <div className="mt-2 text-[11px] text-emerald-200/70">
                  Timed lines are available. Scroll manually or tap a line to jump.
                </div>
              )}

              <div className="mt-2 text-[11px] text-white/45">
                Source: {providerLabel} {isReliableSyncedLyrics ? "• synced" : "• plain"}
              </div>

              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await copyToClipboard(currentLyricsState.lyrics || "");
                    if (!ok) alert("Copy failed");
                  }}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  <Copy className="mr-1 inline h-3.5 w-3.5" />
                  Copy
                </button>

                <button
                  type="button"
                  onClick={() => setLyricsEditMode(true)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
                >
                  <Pencil className="mr-1 inline h-3.5 w-3.5" />
                  Edit
                </button>

                <button
                  type="button"
                  onClick={() => setLyricsOpen(false)}
                  className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500/25"
                >
                  Done
                </button>
              </div>
            </>
          )}
        </div>
      </Sheet>

      <Sheet
        open={profileOpen}
        title="Profile"
        subtitle="Lightweight settings for Lumie"
        onClose={() => setProfileOpen(false)}
      >
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
              <User className="h-5 w-5 text-white/70" />
            </div>
            <div>
              <div className="text-sm font-semibold">Lumie</div>
              <div className="text-xs text-white/50">
                AI-assisted smart loop music player
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-white/45">Tracks</div>
              <div className="mt-1 text-sm font-semibold">{tracks.length}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-white/45">Liked</div>
              <div className="mt-1 text-sm font-semibold">{likedCount}</div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-white/45">Voice reply</div>
              <div className="mt-1 text-sm font-semibold">
                {voiceReplyOn ? "On" : "Off"}
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-[11px] text-white/45">Hands-free</div>
              <div className="mt-1 text-sm font-semibold">{handsFreeStateText}</div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
            <div className="text-[11px] text-white/45">About</div>
            <div className="mt-1 text-xs leading-relaxed text-white/70">
              Lumie combines music playback, loop controls, timers, typed commands,
              push-to-talk, hands-free wake-word support, synced lyrics, and playlist interaction in a compact Spotify-style interface.
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const next = !voiceReplyOn;
                setVoiceReplyOn(next);
                if (!next && "speechSynthesis" in window) {
                  window.speechSynthesis.cancel();
                  handsFreeSpeakingRef.current = false;
                  setVoiceReplyStatus("");
                }
              }}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
            >
              {voiceReplyOn ? "Turn voice reply off" : "Turn voice reply on"}
            </button>

            <button
              type="button"
              onClick={() => setCommandHistory([])}
              className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-white/70 hover:bg-white/10"
            >
              Clear history
            </button>

            <button
              type="button"
              onClick={() => setProfileOpen(false)}
              className="rounded-full border border-emerald-400/30 bg-emerald-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500/25"
            >
              Done
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}