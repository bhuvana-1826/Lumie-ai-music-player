"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type LoopMode = 1 | 2 | 3 | "infinity";

type StopRule =
  | { type: "none" }
  | {
      type: "in";
      remainingSec: number;
      state: "armed" | "running" | "paused";
    }
  | { type: "at"; atSec: number }
  | { type: "endLoop"; loopModeSnapshot: LoopMode };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatTime(sec: number) {
  if (!isFinite(sec) || sec < 0) return "0:00";

  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);

  return `${m}:${String(s).padStart(2, "0")}`;
}

export function useAudioPlayer(src: string) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const [loopMode, setLoopModeState] = useState<LoopMode>(1);
  const [loopedTimes, setLoopedTimes] = useState(0);

  const [stopRule, setStopRule] = useState<StopRule>({
    type: "none",
  });

  const [playlistAdvanceSignal, setPlaylistAdvanceSignal] = useState(0);

  const loopModeRef = useRef<LoopMode>(1);
  const loopedTimesRef = useRef(0);
  const stopRuleRef = useRef<StopRule>({
    type: "none",
  });

  const stopRemainingSecRef = useRef<number | null>(null);
  const stopLastTickMsRef = useRef<number | null>(null);
  const stopAtTrackSecRef = useRef<number | null>(null);
  const stopAfterRepeatTargetRef = useRef<number | null>(null);

  useEffect(() => {
    loopModeRef.current = loopMode;
  }, [loopMode]);

  useEffect(() => {
    loopedTimesRef.current = loopedTimes;
  }, [loopedTimes]);

  useEffect(() => {
    stopRuleRef.current = stopRule;
  }, [stopRule]);

  useEffect(() => {
    if (audioRef.current) return;

    const a = new Audio();

    a.preload = "metadata";
    a.crossOrigin = "anonymous";

    audioRef.current = a;

    return () => {
      try {
        a.pause();
      } catch {}

      audioRef.current = null;
    };
  }, []);

  function clearStopState() {
    stopAtTrackSecRef.current = null;
    stopAfterRepeatTargetRef.current = null;
    stopRemainingSecRef.current = null;
    stopLastTickMsRef.current = null;

    setStopRule({
      type: "none",
    });
  }

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    setIsReady(false);
    setIsPlaying(false);
    setCurrent(0);
    setDuration(0);
    setLoopedTimes(0);

    clearStopState();

    try {
      a.pause();
    } catch {}

    try {
      a.currentTime = 0;
    } catch {}

    if (!src) {
      a.removeAttribute("src");
      a.load();
      return;
    }

    a.src = src;
    a.load();
  }, [src]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onLoadedMetadata = () => {
      setIsReady(true);
      setDuration(isFinite(a.duration) ? a.duration : 0);
      setCurrent(isFinite(a.currentTime) ? a.currentTime : 0);
    };

    const onDurationChange = () => {
      setDuration(isFinite(a.duration) ? a.duration : 0);
    };

    const onTimeUpdate = () => {
      const currentTime = isFinite(a.currentTime) ? a.currentTime : 0;

      setCurrent(currentTime);

      const stopAt = stopAtTrackSecRef.current;

      if (
        stopAt !== null &&
        currentTime >= stopAt
      ) {
        try {
          a.pause();
        } catch {}

        clearStopState();
      }
    };

    const onPlay = () => {
      setIsPlaying(true);
    };

    const onPause = () => {
      setIsPlaying(false);
    };

    const onEnded = async () => {
      const lm = loopModeRef.current;
      const lt = loopedTimesRef.current;

      const stopTarget = stopAfterRepeatTargetRef.current;

      // stop after loop
      if (stopTarget !== null) {
        if (lt < stopTarget) {
          setLoopedTimes((t) => t + 1);

          try {
            a.currentTime = 0;
            await a.play();
            return;
          } catch {
            setIsPlaying(false);
            return;
          }
        }

        clearStopState();
        setLoopedTimes(0);
        setIsPlaying(false);

        return;
      }

      // infinity loop
      if (lm === "infinity") {
        setLoopedTimes((t) => t + 1);

        try {
          a.currentTime = 0;
          await a.play();
          return;
        } catch {
          setIsPlaying(false);
          return;
        }
      }

      // finite loop
      const maxRepeats = Math.max(0, lm - 1);

      if (lt < maxRepeats) {
        setLoopedTimes((t) => t + 1);

        try {
          a.currentTime = 0;
          await a.play();
          return;
        } catch {
          setIsPlaying(false);
          return;
        }
      }

      setLoopedTimes(0);

      // trigger next track
      setPlaylistAdvanceSignal(Date.now());
    };

    a.addEventListener("loadedmetadata", onLoadedMetadata);
    a.addEventListener("durationchange", onDurationChange);
    a.addEventListener("timeupdate", onTimeUpdate);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("loadedmetadata", onLoadedMetadata);
      a.removeEventListener("durationchange", onDurationChange);
      a.removeEventListener("timeupdate", onTimeUpdate);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  // stop in X seconds countdown
  useEffect(() => {
    if (stopRule.type !== "in") return;
    if (stopRule.state !== "running") return;

    const intervalId = window.setInterval(() => {
      setStopRule((rule) => {
        if (rule.type !== "in") return rule;
        if (rule.state !== "running") return rule;

        const nextRemaining = Math.max(
          0,
          rule.remainingSec - 1
        );

        if (nextRemaining <= 0) {
          const a = audioRef.current;

          try {
            a?.pause();
          } catch {}

          stopRemainingSecRef.current = null;
          stopLastTickMsRef.current = null;

          return {
            type: "none",
          };
        }

        stopRemainingSecRef.current = nextRemaining;

        return {
          ...rule,
          remainingSec: nextRemaining,
        };
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [stopRule]);

  const ui = useMemo(() => {
    return {
      currentText: formatTime(current),
      durationText: formatTime(duration),
    };
  }, [current, duration]);

  const actions = useMemo(() => {
    return {
      play: async () => {
        const a = audioRef.current;
        if (!a || !src) return;

        await a.play();
      },

      pause: () => {
        audioRef.current?.pause();
      },

      seekTo: (sec: number) => {
        const a = audioRef.current;
        if (!a) return;

        const nextTime = clamp(
          sec,
          0,
          duration || 0
        );

        a.currentTime = nextTime;
        setCurrent(nextTime);
      },

      seekBy: (delta: number) => {
        const a = audioRef.current;
        if (!a) return;

        const nextTime = clamp(
          (isFinite(a.currentTime)
            ? a.currentTime
            : 0) + delta,
          0,
          duration || 0
        );

        a.currentTime = nextTime;
        setCurrent(nextTime);
      },

      setLoopMode: (m: LoopMode) => {
        setLoopModeState(m);
        setLoopedTimes(0);
      },

      setStopInSeconds: (sec: number) => {
        const safeSec = Math.max(
          1,
          Math.floor(sec)
        );

        stopRemainingSecRef.current = safeSec;
        stopLastTickMsRef.current = Date.now();

        setStopRule({
          type: "in",
          remainingSec: safeSec,
          state: "running",
        });
      },

      setStopAtTrack: (sec: number) => {
        const safeSec = clamp(
          sec,
          0,
          duration || 0
        );

        stopAtTrackSecRef.current = safeSec;

        setStopRule({
          type: "at",
          atSec: safeSec,
        });
      },

      setStopAfterLoopCycle: () => {
        const lm = loopModeRef.current;

        if (lm === "infinity") {
          return false;
        }

        const repeatTarget = Math.max(
          0,
          lm - 1
        );

        stopAfterRepeatTargetRef.current =
          repeatTarget;

        setStopRule({
          type: "endLoop",
          loopModeSnapshot: lm,
        });

        return true;
      },

      cancelStop: () => {
        clearStopState();
      },
    };
  }, [duration, src]);

  return {
    audioRef,
    isReady,
    isPlaying,
    current,
    duration,
    loopMode,
    loopedTimes,
    playlistAdvanceSignal,
    ui,
    stop: {
      rule: stopRule,
    },
    actions,
  };
}