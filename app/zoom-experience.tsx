"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ZoomCanvas from "./zoom-canvas";

type ZoomExperienceProps = {
  imageSets: ImageSet[];
  initialSet?: string;
};

export type ImageSet = {
  name: string;
  images: string[];
};

const FADE_IN_DURATION_MS = 400; // 0 -> 50% opacity
const FADE_TO_BLACK_DURATION_MS = 400; // 50% -> 100% opacity
const HOLD_DURATION_MS = 200; // Hold at 100% while swapping images
const FADE_OUT_DURATION_MS = 800; // 100% -> 0% opacity
const BUTTON_RADIUS = 30; // Radius of each circular button
const INNER_RADIUS = 65; // Inner radius of the ring
const PADDING = 16; // Padding between buttons and outer edge
// Derived values:
// - Buttons arranged along circle at: INNER_RADIUS + BUTTON_RADIUS
// - Outer radius of ring: INNER_RADIUS + 2 * BUTTON_RADIUS + PADDING
const BUTTON_CIRCLE_RADIUS = INNER_RADIUS + BUTTON_RADIUS;
const OUTER_RADIUS = INNER_RADIUS + 2 * BUTTON_RADIUS + PADDING;
const RING_THICKNESS = 2 * BUTTON_RADIUS + PADDING; // Outer - Inner
const ROTATION_EASING = 0.12;
const SNAP_THRESHOLD = 0.1;
const CLICKS_PER_FULL_CIRCLE = 24; // Number of tick sounds per full rotation
const MIN_PLAYBACK_RATE = 1 / 2; // 1/2x speed at max zoom out (0.5)
const MAX_PLAYBACK_RATE = 2.0; // 2x speed at max zoom in
const MIDDLE_PLAYBACK_RATE = 1.0; // 1x speed at middle zoom
// Quadratic coefficients for mapping normalized zoom (0-1) to playback rate
// Formula: QUADRATIC_A * normalized^2 + QUADRATIC_B * normalized + MIN_PLAYBACK_RATE
// Maps: 0 → 1/2 (0.5), 0.5 → 1.0, 1 → 2.0
// Calculated: a = 1.0, b = 0.5
const QUADRATIC_A = 1.0;
const QUADRATIC_B = 0.5;
const RING_HIDE_DELAY_MS = 1000; // keep ring/buttons visible after leaving dial area
const INTRO_FADE_MS = 400;
const INTRO_BUTTON_DELAY_MS = 1000;

function PhoneSideIcon() {
  return (
    <svg
      aria-hidden
      width="160"
      height="190"
      viewBox="0 0 160 190"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="drop-shadow-[0_0_16px_rgba(0,0,0,0.45)] phone-animate"
    >
      <g className="phone-outline">
        <rect
          x="44"
          y="10"
          width="71.221"
          height="144.204"
          rx="10"
          stroke="white"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
        <line
          x1="73.28"
          y1="16.546"
          x2="85.945"
          y2="16.546"
          stroke="white"
          strokeOpacity="0.5"
          strokeWidth="1"
          strokeLinecap="round"
        />
      </g>
      <g className="phone-shapes">
        <rect
          x="70.6105"
          y="73.102"
          width="18"
          height="18"
          rx="3.5"
          fill="white"
          fillOpacity="0.9"
        />
      </g>
    </svg>
  );
}

function DialSideIcon() {
  const cx = 80;
  const cy = 80;
  const ringR = 33;
  const dots = [
    { x: cx + ringR * Math.sin(0), y: cy - ringR * Math.cos(0) }, // top
    { x: cx + ringR * Math.sin(Math.PI / 3), y: cy - ringR * Math.cos(Math.PI / 3) },
    { x: cx + ringR * Math.sin((2 * Math.PI) / 3), y: cy - ringR * Math.cos((2 * Math.PI) / 3) },
    { x: cx + ringR * Math.sin(Math.PI), y: cy - ringR * Math.cos(Math.PI) }, // bottom (active start)
    { x: cx + ringR * Math.sin((4 * Math.PI) / 3), y: cy - ringR * Math.cos((4 * Math.PI) / 3) },
    { x: cx + ringR * Math.sin((5 * Math.PI) / 3), y: cy - ringR * Math.cos((5 * Math.PI) / 3) },
  ];

  return (
    <svg
      aria-hidden
      width="148"
      height="148"
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="dial-animate drop-shadow-[0_0_12px_rgba(0,0,0,0.4)]"
    >
      <g className="dial-ring">
        <circle
          cx="80"
          cy="80"
          r="56.1355"
          fill="none"
          stroke="white"
          strokeOpacity="0.5"
          strokeWidth="1"
        />
        {dots.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="9"
            fill="white"
            fillOpacity={i === 3 ? 0.9 : 0.5}
            stroke="none"
            strokeWidth={0}
          />
        ))}
      </g>
      {/* Static ring highlighting bottom position */}
      <circle
        cx={cx}
        cy={cy + ringR}
        r="12.5"
        fill="none"
        stroke="white"
        strokeOpacity="0.5"
        strokeWidth="1"
      />
    </svg>
  );
}

declare global {
  interface DeviceOrientationEvent {
    requestPermission?: () => Promise<"granted" | "denied">;
  }
}

const formatLabel = (name: string) =>
  name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

export default function ZoomExperience({
  imageSets,
  initialSet,
}: ZoomExperienceProps) {
  const resolveInitialSet = useCallback(() => {
    if (initialSet) {
      const match = imageSets.find((set) => set.name === initialSet);
      if (match) {
        return match.name;
      }
    }
    // Default to first set
    return imageSets[0]?.name ?? "";
  }, [imageSets, initialSet]);

  const [activeSet, setActiveSet] = useState(resolveInitialSet);
  const [pendingSet, setPendingSet] = useState<string | null>(null);
  const [fadePhase, setFadePhase] = useState<
    "idle" | "loading" | "fading-to-black" | "holding" | "fading-out"
  >("idle");
  const [highlightSet, setHighlightSet] = useState(() => resolveInitialSet());
  const [revealReady, setRevealReady] = useState(false);
  const [orientation, setOrientation] = useState<number | null>(null);
  const [rawOrientation, setRawOrientation] = useState<number | null>(null);
  const [permissionState, setPermissionState] = useState<
    "checking" | "needs-permission" | "granted" | "denied" | "unavailable"
  >("checking");
  const [isMobile, setIsMobile] = useState(false);
  const [audioStarted, setAudioStarted] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [dotCount, setDotCount] = useState(1);
  const [minLoadingTimePassed, setMinLoadingTimePassed] = useState(false);
  const [introStage, setIntroStage] = useState<0 | 1>(0);
  const [introFade, setIntroFade] = useState<"idle" | "out" | "in">("idle");
  const [animFade, setAnimFade] = useState<"in" | "out">("in");
  const [buttonReady, setButtonReady] = useState(false);

  // Circular selector state
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Animate the loading dots (1, 2, 3, 1, 2, 3...)
  useEffect(() => {
    const isVisible = isInitialLoading || !minLoadingTimePassed;
    if (!isVisible) return;
    const interval = setInterval(() => {
      setDotCount((prev) => {
        if (prev >= 3) {
          return 1;
        }
        return prev + 1;
      });
    }, 250);
    return () => clearInterval(interval);
  }, [isInitialLoading, minLoadingTimePassed]);

  // Minimum loading time of 1 second
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinLoadingTimePassed(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const initialIndex = useMemo(() => {
    const idx = imageSets.findIndex((set) => set.name === resolveInitialSet());
    return idx >= 0 ? idx : 0;
  }, [imageSets, resolveInitialSet]);

  const [ringRotation, setRingRotation] = useState(0);
  const [targetRotation, setTargetRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isSelectedCircleHovered, setIsSelectedCircleHovered] = useState(false);
  const [showRingAfterStart, setShowRingAfterStart] = useState(false);
  const dragStartRef = useRef<{ lastAngle: number } | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  const clickStartRef = useRef<{ x: number; y: number; index: number } | null>(
    null
  );
  const ringRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const hoverTimeoutRef = useRef<number | null>(null);
  const introButtonTimeoutRef = useRef<number | null>(null);
  const introTransitionTimeoutRef = useRef<number | null>(null);
  const audioStartTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const tickBufferRef = useRef<AudioBuffer | null>(null);
  const lastClickIndexRef = useRef<number | null>(null);
  const bgMusicRef = useRef<AudioBufferSourceNode | null>(null);
  const bgMusicGainRef = useRef<GainNode | null>(null);
  const bgMusicBufferRef = useRef<AudioBuffer | null>(null);
  const isMutedRef = useRef(false);
  const zoomRangeRef = useRef<{ min: number; max: number } | null>(null);

  const handleNextStage = useCallback(() => {
    if (introStage === 1) return;
    setIntroFade("out");
    setAnimFade("out");
    setButtonReady(false);
    if (introButtonTimeoutRef.current) {
      window.clearTimeout(introButtonTimeoutRef.current);
      introButtonTimeoutRef.current = null;
    }
    introTransitionTimeoutRef.current = window.setTimeout(() => {
      setIntroStage(1);
      setIntroFade("in");
      setAnimFade("in");
      introButtonTimeoutRef.current = window.setTimeout(() => {
        setButtonReady(true);
      }, INTRO_BUTTON_DELAY_MS);
      window.setTimeout(() => setIntroFade("idle"), INTRO_FADE_MS);
    }, INTRO_FADE_MS);
  }, [introStage]);

  // initial button delay
  useEffect(() => {
    introButtonTimeoutRef.current = window.setTimeout(() => {
      setButtonReady(true);
    }, INTRO_BUTTON_DELAY_MS);
    return () => {
      if (introButtonTimeoutRef.current) {
        window.clearTimeout(introButtonTimeoutRef.current);
      }
      if (introTransitionTimeoutRef.current) {
        window.clearTimeout(introTransitionTimeoutRef.current);
      }
    };
  }, []);

  const anglePerItem = useMemo(
    () => (imageSets.length > 0 ? (2 * Math.PI) / imageSets.length : 0),
    [imageSets.length]
  );

  const anglePerClick = useMemo(
    () => (2 * Math.PI) / CLICKS_PER_FULL_CIRCLE,
    []
  );

  const hideRingAfterDelay = useCallback(() => {
    // Don't hide if transitioning
    if (fadePhase !== "idle") {
      return;
    }
    if (audioStartTimeoutRef.current !== null) {
      clearTimeout(audioStartTimeoutRef.current);
      audioStartTimeoutRef.current = null;
    }
    audioStartTimeoutRef.current = window.setTimeout(() => {
      // Check again if still idle before hiding
      if (fadePhase === "idle") {
        setShowRingAfterStart(false);
      }
      audioStartTimeoutRef.current = null;
    }, RING_HIDE_DELAY_MS);
  }, [fadePhase]);

  // Get background music volume - lower on mobile
  const getBgMusicVolume = useCallback(() => {
    return isMobile ? 0.05 : 0.25; // 5% on mobile, 25% on desktop
  }, [isMobile]);

  // Initialize audio buffers during loading phase (before user interaction)
  const initializeAudio = useCallback(async () => {
    if (audioReady) return; // Already initialized

    try {
      // Initialize audio context (will be suspended until user gesture)
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      // Fetch and decode the tick sound
      if (!tickBufferRef.current && audioContextRef.current) {
        const response = await fetch("/tick.mp3");
        const arrayBuffer = await response.arrayBuffer();
        tickBufferRef.current =
          await audioContextRef.current.decodeAudioData(arrayBuffer);
      }

      // Fetch and decode the background music
      if (!bgMusicBufferRef.current && audioContextRef.current) {
        try {
          const response = await fetch("/bg.mp3");
          const arrayBuffer = await response.arrayBuffer();
          bgMusicBufferRef.current =
            await audioContextRef.current.decodeAudioData(arrayBuffer);
        } catch {
          // Ignore errors
        }
      }

      // Mark audio as ready
      setAudioReady(true);
    } catch {
      // Ignore errors, but still mark as ready to allow progression
      setAudioReady(true);
    }
  }, [audioReady]);

  // Initialize audio during loading phase
  useEffect(() => {
    initializeAudio();
  }, [initializeAudio]);

  // Start audio - called by tapping the selector circle or overlay
  const startAudio = useCallback(async () => {
    if (audioStarted) return; // Already started

    try {
      // Request motion permission FIRST (must be in direct user gesture call stack on iOS)
      if (isMobile && permissionState === "needs-permission") {
        // biome-ignore lint/suspicious/noExplicitAny: iOS-specific API
        const DeviceMotionEventClass = DeviceMotionEvent as any;
        if (typeof DeviceMotionEventClass.requestPermission === "function") {
          try {
            const permission = await DeviceMotionEventClass.requestPermission();
            if (permission === "granted") {
              setPermissionState("granted");
            } else {
              setPermissionState("denied");
            }
          } catch (error) {
            setPermissionState("denied");
          }
        }
      }

      // Resume audio context if suspended
      if (
        audioContextRef.current &&
        audioContextRef.current.state === "suspended"
      ) {
        await audioContextRef.current.resume();
        // Ensure gain is still set correctly after resume (mobile safeguard)
        if (bgMusicGainRef.current && !isMutedRef.current) {
          bgMusicGainRef.current.gain.value = getBgMusicVolume();
        }
      }

      // Start background music only if not muted and buffer is loaded
      if (
        !isMutedRef.current &&
        audioContextRef.current &&
        bgMusicBufferRef.current &&
        !bgMusicRef.current
      ) {
        const ctx = audioContextRef.current;

        // Create gain node for volume control
        const gain = ctx.createGain();
        gain.gain.value = getBgMusicVolume();
        gain.connect(ctx.destination);
        bgMusicGainRef.current = gain;

        // Create buffer source
        const source = ctx.createBufferSource();
        source.buffer = bgMusicBufferRef.current;
        source.loop = true;
        source.playbackRate.value = MIDDLE_PLAYBACK_RATE;
        source.connect(gain);
        source.start(0);

        bgMusicRef.current = source;
      }

      setAudioStarted(true);
      // Don't show ring after start - let user discover it by hovering
    } catch {
      // Ignore errors
    }
  }, [audioStarted, isMobile, permissionState, getBgMusicVolume]);

  // Sync mute ref with state
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  // Cleanup audio on unmount
  useEffect(
    () => () => {
      if (bgMusicRef.current) {
        bgMusicRef.current.stop();
        bgMusicRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    },
    []
  );

  // Play tick sound using Web Audio API (supports rapid playback on mobile)
  const playTick = useCallback(async () => {
    if (!(audioContextRef.current && tickBufferRef.current)) return;
    if (isMutedRef.current) return;

    try {
      // Resume context if suspended (mobile requirement)
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
        // Ensure gain is still set correctly after resume (mobile safeguard)
        if (bgMusicGainRef.current && !isMutedRef.current) {
          bgMusicGainRef.current.gain.value = getBgMusicVolume();
        }
      }

      // Ensure context is running
      if (audioContextRef.current.state !== "running") {
        return;
      }

      // Create a new buffer source for each play (Web Audio API pattern)
      const source = audioContextRef.current.createBufferSource();
      const gainNode = audioContextRef.current.createGain();
      gainNode.gain.value = 1.0; // Full volume

      source.buffer = tickBufferRef.current;
      source.connect(gainNode);
      gainNode.connect(audioContextRef.current.destination);
      source.start(0);
    } catch {
      // Ignore errors
    }
  }, [getBgMusicVolume]);

  // Update audio playback rate based on zoom
  // Using Web Audio API - smooth, real-time updates with zero stutter
  const updatePlaybackRate = useCallback(
    (zoomExponent: number, zoomRange: { min: number; max: number }) => {
      zoomRangeRef.current = zoomRange;

      if (!bgMusicRef.current || isMutedRef.current) return;

      // Normalize zoom exponent to 0-1 range
      const normalized =
        zoomRange.max === zoomRange.min
          ? 0.5
          : (zoomExponent - zoomRange.min) / (zoomRange.max - zoomRange.min);

      // Map normalized value (0-1) to playback rate using quadratic function
      // 0 → 0.25 (1/4x), 0.5 → 1.0 (1x), 1 → 4.0 (4x)
      // Formula: QUADRATIC_A * normalized^2 + QUADRATIC_B * normalized + MIN_PLAYBACK_RATE
      const playbackRate =
        QUADRATIC_A * normalized * normalized +
        QUADRATIC_B * normalized +
        MIN_PLAYBACK_RATE;

      // Update playbackRate directly - Web Audio API handles this smoothly
      bgMusicRef.current.playbackRate.value = playbackRate;
    },
    []
  );

  // Toggle mute state
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      // Update ref immediately for synchronous access
      isMutedRef.current = newMuted;

      // Update background music using gain node for mute/unmute
      if (bgMusicGainRef.current) {
        bgMusicGainRef.current.gain.value = newMuted ? 0 : getBgMusicVolume();
      }

      // If unmuting and music isn't playing, start it
      if (
        !(newMuted || bgMusicRef.current) &&
        audioContextRef.current &&
        bgMusicBufferRef.current
      ) {
        const ctx = audioContextRef.current;
        const gain = ctx.createGain();
        gain.gain.value = getBgMusicVolume();
        gain.connect(ctx.destination);
        bgMusicGainRef.current = gain;

        const source = ctx.createBufferSource();
        source.buffer = bgMusicBufferRef.current;
        source.loop = true;
        source.playbackRate.value = MIDDLE_PLAYBACK_RATE;
        source.connect(gain);
        source.start(0);

        bgMusicRef.current = source;
      }
      return newMuted;
    });
  }, [getBgMusicVolume]);

  // Check for tick sound when crossing click boundaries
  // Aligned so ticks occur when items reach the bottom position (PI/2)
  const checkAndPlayTick = useCallback(
    (rotation: number) => {
      // Offset rotation to align with bottom position (PI/2)
      // When rotation = 0, item at index 0 is at bottom (PI/2)
      // So we offset by -PI/2 to make bottom position = 0
      const offsetRotation = rotation - Math.PI / 2;
      const normalizedRotation =
        ((offsetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const currentClickIndex = Math.floor(normalizedRotation / anglePerClick);

      // Play sound if we've crossed a boundary
      if (lastClickIndexRef.current !== null) {
        const prevIndex = lastClickIndexRef.current;

        // Check if we've crossed a boundary (different click index)
        if (currentClickIndex !== prevIndex) {
          playTick();
        }
      }

      lastClickIndexRef.current = currentClickIndex;
    },
    [anglePerClick, playTick]
  );

  // Get the index of the item at the bottom (selected)
  const selectedIndex = useMemo(() => {
    if (imageSets.length === 0) return 0;
    // Normalize rotation to 0-2π range
    const normalizedRotation =
      ((ringRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    // When ringRotation = 0, item at index 0 is at bottom (PI/2)
    // The ring rotates counter-clockwise (negative rotation applied)
    // So as ringRotation increases, we need to find which index is now at bottom
    const rawIndex = Math.round(normalizedRotation / anglePerItem);
    return (
      ((rawIndex % imageSets.length) + imageSets.length) % imageSets.length
    );
  }, [ringRotation, anglePerItem, imageSets.length]);

  // Animation loop for smooth rotation
  useEffect(() => {
    const animate = () => {
      setRingRotation((prev) => {
        const diff = targetRotation - prev;
        const newRotation =
          Math.abs(diff) < 0.001
            ? targetRotation
            : prev + diff * ROTATION_EASING;
        // Check for tick sound based on the actual animated rotation
        checkAndPlayTick(newRotation);
        return newRotation;
      });
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [targetRotation, checkAndPlayTick]);

  // Snap to nearest item when not dragging
  useEffect(() => {
    if (!isDragging && imageSets.length > 0) {
      const nearestIndex = Math.round(targetRotation / anglePerItem);
      const snappedRotation = nearestIndex * anglePerItem;
      if (
        Math.abs(targetRotation - snappedRotation) >
        SNAP_THRESHOLD * anglePerItem
      ) {
        setTargetRotation(snappedRotation);
      }
    }
  }, [isDragging, targetRotation, anglePerItem, imageSets.length]);

  // Calculate angle from center of ring to pointer
  const getPointerAngle = useCallback((clientX: number, clientY: number) => {
    if (!ringRef.current) return 0;
    const rect = ringRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    return Math.atan2(clientY - centerY, clientX - centerX);
  }, []);

  // Handle entering dial area - cancels hide timer
  const handleDialEnter = useCallback(() => {
    // Cancel hide timer if user enters dial area
    if (audioStartTimeoutRef.current !== null) {
      clearTimeout(audioStartTimeoutRef.current);
      audioStartTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current !== null) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }, []);

  // Handle hover on selected button
  const handlePointerEnter = useCallback(() => {
    handleDialEnter();
    // Show dial when hovering
    setShowRingAfterStart(true);
    setIsHovered(true);
  }, [handleDialEnter]);

  const handlePointerLeave = useCallback(() => {
    if (!isDragging) {
      // Clear any existing timeout
      if (hoverTimeoutRef.current !== null) {
        clearTimeout(hoverTimeoutRef.current);
      }
      // Set hover to false immediately
      setIsHovered(false);
      // Hide dial after 1 second (re-entering cancels this timer)
      hideRingAfterDelay();
    }
  }, [isDragging, hideRingAfterDelay]);

  // Handle hover on selected circle bg
  const handleSelectedCircleEnter = useCallback(() => {
    handleDialEnter();
    // Show dial when hovering selected circle
    setShowRingAfterStart(true);
    setIsSelectedCircleHovered(true);
  }, [handleDialEnter]);

  const handleSelectedCircleLeave = useCallback(() => {
    if (!isDragging) {
      // Clear any existing timeout
      if (hoverTimeoutRef.current !== null) {
        clearTimeout(hoverTimeoutRef.current);
      }
      // Set hover to false immediately
      setIsSelectedCircleHovered(false);
      // Hide dial after 1 second (re-entering cancels this timer)
      hideRingAfterDelay();
    }
  }, [isDragging, hideRingAfterDelay]);

  // Handle drag start - selected button can always drag, others need ring visible
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, isSelectedButton = false, buttonIndex?: number) => {
      if (!audioStarted || fadePhase !== "idle") return;

      // Selected button can always drag - show ring when dragging starts
      if (isSelectedButton) {
        setShowRingAfterStart(true);
        setIsHovered(true);
      } else {
        // Other buttons only when ring is visible
        if (!(isHovered || isSelectedCircleHovered || showRingAfterStart))
          return;
      }

      // Track click start position and index for click detection
      if (buttonIndex !== undefined) {
        clickStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          index: buttonIndex,
        };
      }

      setIsDragging(true);
      const lastAngle = getPointerAngle(e.clientX, e.clientY);
      dragStartRef.current = { lastAngle };
      // Store the selected index at drag start to ensure only one change per drag
      dragStartIndexRef.current = selectedIndex;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [
      audioStarted,
      fadePhase,
      getPointerAngle,
      isHovered,
      isSelectedCircleHovered,
      showRingAfterStart,
      selectedIndex,
    ]
  );

  // Handle drag move
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!(isDragging && dragStartRef.current)) return;

      // If we have a click start, check if movement is significant (more than 5px)
      // If so, clear the click start to indicate this is a drag, not a click
      if (clickStartRef.current) {
        const dx = e.clientX - clickStartRef.current.x;
        const dy = e.clientY - clickStartRef.current.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > 5) {
          clickStartRef.current = null; // Significant movement = drag, not click
        }
      }

      const currentAngle = getPointerAngle(e.clientX, e.clientY);
      let delta = currentAngle - dragStartRef.current.lastAngle;

      // Handle wrap-around for the small movement
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;

      dragStartRef.current.lastAngle = currentAngle;

      // Apply rotation (subtract delta to follow finger)
      setTargetRotation((prev) => prev - delta);
    },
    [isDragging, getPointerAngle]
  );

  // Handle drag end and snap to nearest
  const handlePointerUp = useCallback(() => {
    if (!isDragging) return;

    // Check if this was a click (no significant movement) and dial is visible
    const isDialVisible =
      isHovered || isSelectedCircleHovered || showRingAfterStart;
    if (clickStartRef.current && isDialVisible) {
      // This was a click, not a drag - rotate to the clicked image's position
      const clickedIndex = clickStartRef.current.index;
      const targetRotationForIndex = clickedIndex * anglePerItem;

      // Calculate shortest rotation path, preferring clockwise for equal distance
      const currentNormalized =
        ((targetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const targetNormalized =
        ((targetRotationForIndex % (2 * Math.PI)) + 2 * Math.PI) %
        (2 * Math.PI);
      let diff = targetNormalized - currentNormalized;

      // Normalize to [-π, π] range for shortest path
      if (diff > Math.PI) {
        diff -= 2 * Math.PI;
      } else if (diff < -Math.PI) {
        diff += 2 * Math.PI;
      }

      // If exactly 180 degrees, prefer clockwise (positive)
      if (Math.abs(Math.abs(diff) - Math.PI) < 0.001) {
        diff = Math.PI;
      }

      // Calculate final target rotation by adding the normalized difference
      const finalTarget = targetRotation + diff;
      setTargetRotation(finalTarget);
      clickStartRef.current = null;
    } else {
      // This was a drag - snap to nearest item
      const nearestIndex = Math.round(targetRotation / anglePerItem);
      const snappedRotation = nearestIndex * anglePerItem;
      setTargetRotation(snappedRotation);
    }

    setIsDragging(false);
    dragStartRef.current = null;
    clickStartRef.current = null;

    // Keep hover state active - let pointer leave handler manage fade out
    // Note: dragStartIndexRef remains set until transition is triggered
    // This ensures only one transition per drag
  }, [
    isDragging,
    targetRotation,
    anglePerItem,
    isHovered,
    isSelectedCircleHovered,
    showRingAfterStart,
  ]);

  // Cleanup timeouts on unmount
  useEffect(
    () => () => {
      if (hoverTimeoutRef.current !== null) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (audioStartTimeoutRef.current !== null) {
        clearTimeout(audioStartTimeoutRef.current);
      }
    },
    []
  );

  // Handle wheel for rotation - only when ring is visible
  // Don't prevent default so zoom can still work
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!audioStarted || fadePhase !== "idle") return;
      // Rotate the ring but don't prevent default - let zoom canvas also handle it
      const delta = e.deltaY * 0.003;
      setTargetRotation((prev) => prev + delta);
      // Don't call e.preventDefault() - allow zoom to work simultaneously
    },
    [audioStarted, fadePhase]
  );

  // Initialize ring rotation based on initial set
  useEffect(() => {
    const initialRotation = initialIndex * anglePerItem;
    setRingRotation(initialRotation);
    setTargetRotation(initialRotation);
    // Initialize the last click index (with bottom position offset)
    const offsetRotation = initialRotation - Math.PI / 2;
    const normalizedRotation =
      ((offsetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    lastClickIndexRef.current = Math.floor(normalizedRotation / anglePerClick);
  }, [initialIndex, anglePerItem, anglePerClick]);

  const requestMotionPermission = useCallback(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: iOS-specific API
    const DeviceMotionEventClass = DeviceMotionEvent as any;

    if (typeof DeviceMotionEventClass.requestPermission === "function") {
      try {
        const permission = await DeviceMotionEventClass.requestPermission();
        if (permission === "granted") {
          setPermissionState("granted");
        } else {
          setPermissionState("denied");
        }
      } catch (error) {
        console.error("Permission request failed:", error);
        setPermissionState("denied");
      }
    }
  }, []);

  useEffect(() => {
    // Detect if mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor;
      const isMobileDevice =
        /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
          userAgent.toLowerCase()
        );
      setIsMobile(isMobileDevice);
      return isMobileDevice;
    };

    const mobile = checkMobile();

    // biome-ignore lint/suspicious/noExplicitAny: iOS-specific API
    const DeviceMotionEventClass = DeviceMotionEvent as any;

    // Check if permission API exists (iOS 13+)
    const hasPermissionAPI =
      typeof DeviceMotionEventClass.requestPermission === "function";

    if (hasPermissionAPI && mobile) {
      setPermissionState("needs-permission");
    } else {
      // Non-iOS or older iOS or desktop - permission not needed, events fire automatically
      setPermissionState("granted");
    }

    // Low-pass filter for smoothing (0.02 = very smooth, 0.06 = more responsive)
    // Slightly reduced to 0.05 to catch jitter at direction changes without adding lag
    const smoothingFactor = 0.05;
    let smoothedDegrees: number | null = null;

    const handleMotion = (event: DeviceMotionEvent) => {
      // Use accelerometer to get tilt relative to gravity
      // This is independent of compass heading (alpha)
      const accel = event.accelerationIncludingGravity;
      if (accel && accel.x !== null && accel.y !== null) {
        // When phone is upright (charging port down, screen facing you):
        // - gravity points down (negative y in device coords)
        // - x tells us left-right tilt
        // atan2(x, -y) gives angle in radians, convert to degrees
        const radians = Math.atan2(accel.x, -accel.y);
        const degrees = radians * (180 / Math.PI);

        // Apply low-pass filter for smoothing
        if (smoothedDegrees === null) {
          smoothedDegrees = degrees;
        } else {
          smoothedDegrees =
            smoothedDegrees * (1 - smoothingFactor) + degrees * smoothingFactor;
        }

        // Raw value for rotation (smoothed), clamped to ±90° (landscape limits)
        const rotationClamped = Math.max(-90, Math.min(90, smoothedDegrees));
        setRawOrientation(rotationClamped);
        // Clamped value for zoom control and display
        const clamped = Math.max(-60, Math.min(60, smoothedDegrees));
        setOrientation(Math.round(clamped));
        if (hasPermissionAPI) {
          setPermissionState("granted");
        }
      }
    };

    window.addEventListener("devicemotion", handleMotion);
    return () => window.removeEventListener("devicemotion", handleMotion);
  }, []);

  useEffect(() => {
    if (imageSets.length === 0) {
      return;
    }
    const exists = imageSets.some((set) => set.name === activeSet);
    if (!exists) {
      setActiveSet(resolveInitialSet());
      setFadePhase("idle");
    }
  }, [activeSet, imageSets, resolveInitialSet]);

  const activeImages = useMemo(() => {
    if (imageSets.length === 0) {
      return [] as string[];
    }
    const selected = imageSets.find((set) => set.name === activeSet);
    return selected?.images ?? imageSets[0]?.images ?? [];
  }, [activeSet, imageSets]);

  // Get canvas opacity based on fade phase
  const getCanvasOpacity = () => {
    if (fadePhase === "idle" || fadePhase === "loading") return 1;
    if (fadePhase === "fading-to-black") return 0;
    if (fadePhase === "holding") return 0;
    if (fadePhase === "fading-out") return 1; // Will transition from 0 to 1
    return 1;
  };

  // Get transition duration based on current phase
  const getTransitionDuration = () => {
    if (fadePhase === "fading-to-black") return FADE_TO_BLACK_DURATION_MS;
    if (fadePhase === "holding") return 0; // No transition during hold
    if (fadePhase === "fading-out") return FADE_OUT_DURATION_MS;
    return 0;
  };

  // Preload images for a given set
  const preloadImages = useCallback(
    (setName: string): Promise<void> => {
      const targetSet = imageSets.find((s) => s.name === setName);
      if (!targetSet) return Promise.resolve();

      return Promise.all(
        targetSet.images.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = new window.Image();
              img.onload = () => resolve();
              img.onerror = () => resolve(); // Continue even if one fails
              img.src = src;
            })
        )
      ).then(() => {});
    },
    [imageSets]
  );

  const startTransition = useCallback(
    (target: string) => {
      if (fadePhase !== "idle" || target === activeSet) {
        return;
      }
      // Start loading images immediately
      setPendingSet(target);
      setHighlightSet(target);
      setRevealReady(false);
      setFadePhase("loading");
    },
    [activeSet, fadePhase]
  );

  // Calculate final selected index from targetRotation (where rotation will settle)
  const finalSelectedIndex = useMemo(() => {
    if (imageSets.length === 0) return 0;
    // Normalize targetRotation to 0-2π range
    const normalizedRotation =
      ((targetRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const rawIndex = Math.round(normalizedRotation / anglePerItem);
    return (
      ((rawIndex % imageSets.length) + imageSets.length) % imageSets.length
    );
  }, [targetRotation, anglePerItem, imageSets.length]);

  // Check if rotation has settled (ringRotation is close to targetRotation)
  // Use a slightly larger threshold for mobile to account for touch event timing
  const rotationSettleThreshold = isMobile ? 0.02 : 0.01;
  const isRotationSettled = useMemo(() => {
    const diff = Math.abs(targetRotation - ringRotation);
    // Normalize the difference to account for wrap-around
    const normalizedDiff = Math.min(diff, 2 * Math.PI - diff);
    return normalizedDiff < rotationSettleThreshold;
  }, [targetRotation, ringRotation, rotationSettleThreshold]);

  // Trigger transition when selected item changes
  // Only allow one transition per drag - check if index changed from drag start
  useEffect(() => {
    // During dragging, don't trigger transitions (wait for drag to end)
    if (isDragging) return;

    // If we have a drag start index, wait for rotation to settle and use final index
    // This prevents intermediate transitions during rotation animation
    if (dragStartIndexRef.current !== null) {
      // Wait for rotation to settle before checking
      if (!isRotationSettled) {
        return;
      }

      const normalizedStartIndex =
        ((dragStartIndexRef.current % imageSets.length) + imageSets.length) %
        imageSets.length;
      const normalizedFinalIndex =
        ((finalSelectedIndex % imageSets.length) + imageSets.length) %
        imageSets.length;

      // If index didn't change, clear the ref and don't transition
      if (normalizedStartIndex === normalizedFinalIndex) {
        dragStartIndexRef.current = null;
        return;
      }

      // Index changed - allow transition to final index
      const selectedSet = imageSets[finalSelectedIndex];
      if (selectedSet && selectedSet.name !== highlightSet) {
        dragStartIndexRef.current = null;
        startTransition(selectedSet.name);
      }
      return;
    }

    // Normal transition (not from drag) - use current selectedIndex
    const selectedSet = imageSets[selectedIndex];
    if (selectedSet && selectedSet.name !== highlightSet) {
      startTransition(selectedSet.name);
    }
  }, [
    selectedIndex,
    finalSelectedIndex,
    imageSets,
    highlightSet,
    isDragging,
    isRotationSettled,
    startTransition,
  ]);

  useEffect(() => {
    if (fadePhase === "fading-to-black") {
      // Fade canvas to black
      const timer = window.setTimeout(() => {
        setFadePhase("holding");
      }, FADE_TO_BLACK_DURATION_MS);
      return () => window.clearTimeout(timer);
    }

    if (fadePhase === "holding") {
      // Hold at black, swap images NOW
      if (pendingSet) {
        setActiveSet(pendingSet);
        setPendingSet(null);
      }
      const timer = window.setTimeout(() => {
        setFadePhase("fading-out");
      }, HOLD_DURATION_MS);
      return () => window.clearTimeout(timer);
    }

    if (fadePhase === "fading-out") {
      // Fade canvas back in
      const timer = window.setTimeout(() => {
        setFadePhase("idle");
        setRevealReady(false);
      }, FADE_OUT_DURATION_MS);
      return () => window.clearTimeout(timer);
    }
    return;
  }, [fadePhase, pendingSet]);

  const handleCanvasReady = useCallback(() => {
    setRevealReady(true);
    setIsInitialLoading(false);
  }, []);

  // During loading phase, preload images then proceed
  useEffect(() => {
    if (fadePhase === "loading" && pendingSet) {
      // Hide the dial immediately when loading starts
      setIsHovered(false);
      setIsSelectedCircleHovered(false);
      setShowRingAfterStart(false);
      // Clear any pending timeouts
      if (audioStartTimeoutRef.current !== null) {
        clearTimeout(audioStartTimeoutRef.current);
        audioStartTimeoutRef.current = null;
      }
      preloadImages(pendingSet).then(() => {
        setRevealReady(true);
        setFadePhase("fading-to-black");
      });
    }
  }, [fadePhase, pendingSet, preloadImages]);

  useEffect(() => {
    setHighlightSet(activeSet);
  }, [activeSet]);

  return (
    <div
      className="relative min-h-[100dvh] min-h-[100svh] w-screen overflow-hidden bg-[#0A0A0A]"
      style={{ minHeight: "100dvh" }}
    >
      <div
        style={{
          opacity: getCanvasOpacity(),
          transition:
            fadePhase === "fading-to-black" ||
            fadePhase === "fading-out" ||
            fadePhase === "holding"
              ? `opacity ${getTransitionDuration()}ms linear`
              : "none",
        }}
      >
        <ZoomCanvas
          enabled={audioStarted}
          images={activeImages}
          isMobile={isMobile}
          onReady={handleCanvasReady}
          onZoomChange={updatePlaybackRate}
          orientation={audioStarted ? orientation : null}
          rawOrientation={audioStarted ? rawOrientation : null}
        />
      </div>

      {/* Mute button - top right */}
      {audioStarted && (
        <button
          aria-label={isMuted ? "Unmute" : "Mute"}
          className="absolute top-4 right-4 z-40 flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-[#0A0A0A]/50 p-3 backdrop-blur-md transition-all hover:scale-110 hover:bg-[#0A0A0A]/70 active:scale-95"
          onClick={toggleMute}
          style={{ boxShadow: "0 0 0 4px rgba(0, 0, 0, 0.2)" }}
          type="button"
        >
          <Image
            alt={isMuted ? "Unmute" : "Mute"}
            className="select-none"
            height={20}
            src={isMuted ? "/volume-on.svg" : "/volume-off.svg"}
            width={20}
          />
        </button>
      )}

      {/* Circular ring selector */}
      {mounted && (
        <div
          className="absolute flex items-center justify-center"
          onPointerEnter={audioStarted ? handleDialEnter : undefined}
          onPointerLeave={audioStarted ? handlePointerLeave : undefined}
          style={{
            left: "50%",
            bottom: "2rem",
            transform: "translateX(-50%)",
            width: OUTER_RADIUS * 2,
            height: OUTER_RADIUS * 2,
            // When ring is not visible, allow events to pass through for zoom
            // But always allow pointer events for selected circle bg
            pointerEvents: audioStarted
              ? audioStarted &&
                !isHovered &&
                !isSelectedCircleHovered &&
                !showRingAfterStart &&
                fadePhase === "idle"
                ? "none"
                : "auto"
              : "none",
            cursor: audioStarted
              ? audioStarted &&
                (isHovered || isSelectedCircleHovered || showRingAfterStart) &&
                fadePhase === "idle"
                ? isDragging
                  ? "grabbing"
                  : "grab"
                : "default"
              : "default",
          }}
        >
          {/* Ring background - only the ring band, not the center */}
          <div
            className="pointer-events-none absolute rounded-full transition-opacity duration-300"
            style={{
              width: OUTER_RADIUS * 2,
              height: OUTER_RADIUS * 2,
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              background: `radial-gradient(circle, rgba(0, 0, 0, 0.5) 0px, rgba(0, 0, 0, 0.5) ${OUTER_RADIUS}px, transparent ${OUTER_RADIUS}px)`,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              opacity:
                audioStarted &&
                fadePhase === "idle" &&
                (isHovered || isSelectedCircleHovered || showRingAfterStart)
                  ? 1
                  : 0,
              zIndex: 1,
              boxShadow: "0 0 0 4px rgba(0, 0, 0, 0.2)",
            }}
          />

          {/* Loading ring - around selected circle, visible during entire transition */}
          <div
            className="pointer-events-none absolute rounded-full transition-opacity duration-300"
            style={{
              width: BUTTON_RADIUS * 2 + 12,
              height: BUTTON_RADIUS * 2 + 12,
              left: OUTER_RADIUS - BUTTON_RADIUS - 6,
              top: OUTER_RADIUS + BUTTON_CIRCLE_RADIUS - BUTTON_RADIUS - 6,
              background:
                "conic-gradient(from 0deg, rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.7))",
              animation: "spin 2s ease-in-out infinite",
              zIndex: 15,
              opacity: fadePhase !== "idle" ? 1 : 0,
              WebkitMask:
                "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
              mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), black calc(100% - 3px))",
            }}
          />

          {/* Permanent slot circle at selected position (bottom) - white transparent */}
          <div
            className="absolute rounded-full transition-opacity duration-300"
            onPointerEnter={
              audioStarted && fadePhase === "idle"
                ? handleSelectedCircleEnter
                : undefined
            }
            onPointerLeave={
              audioStarted && fadePhase === "idle"
                ? handleSelectedCircleLeave
                : undefined
            }
            style={{
              width: `${BUTTON_RADIUS * 2}px`,
              height: `${BUTTON_RADIUS * 2}px`,
              left: "50%",
              top: "50%",
              transform: `translate(calc(-50% + 0px), calc(-50% + ${BUTTON_CIRCLE_RADIUS}px))`,
              background: `radial-gradient(circle, rgba(255, 255, 255, 0.3) 0px, rgba(255, 255, 255, 0.3) ${OUTER_RADIUS}px, transparent ${OUTER_RADIUS}px)`,
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              opacity: audioStarted ? 1 : 0,
              zIndex: 2,
              boxShadow: "0 0 0 4px rgba(0, 0, 0, 0.2)",
              pointerEvents:
                audioStarted && fadePhase === "idle" ? "auto" : "none",
            }}
          />

          {/* Rotating container for image buttons only */}
          <div
            className="absolute inset-0 touch-none transition-opacity duration-300"
            onPointerCancel={handlePointerUp}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={
              audioStarted &&
              fadePhase === "idle" &&
              (isHovered || isSelectedCircleHovered || showRingAfterStart)
                ? handleWheel
                : undefined
            }
            ref={ringRef}
            style={{
              touchAction: "none",
              transform: `rotate(${-ringRotation}rad)`,
              // Only allow pointer events when audio started AND ring is visible AND idle
              pointerEvents:
                audioStarted &&
                fadePhase === "idle" &&
                (isHovered || isSelectedCircleHovered || showRingAfterStart)
                  ? "auto"
                  : "none",
              zIndex: 3,
            }}
          >
            {/* Image items positioned on the ring */}
            {imageSets.map((set, index) => {
              // Position each item around the circle at BUTTON_CIRCLE_RADIUS
              // Start at bottom (0 degrees = π/2), going clockwise
              const itemAngle = index * anglePerItem + Math.PI / 2;
              const x = Math.cos(itemAngle) * BUTTON_CIRCLE_RADIUS;
              const y = Math.sin(itemAngle) * BUTTON_CIRCLE_RADIUS;

              // Check if this item is at the bottom (selected position)
              // Bottom is at angle PI/2 after rotation
              const isAtBottom = index === selectedIndex;
              const preview = set.images[0];
              const label = formatLabel(set.name);

              // Show all items when hovered, only selected when not
              // Before audio starts, hide all buttons. After audio starts, show on hover or if selected
              // During transition: hide all except selected button
              // Group visibility: dial visible when hovering selected image or during delay
              const groupVisible =
                audioStarted &&
                fadePhase === "idle" &&
                (isHovered || isSelectedCircleHovered || showRingAfterStart);
              // Selected button is always visible once audio started (even during loading)
              // Other buttons only visible when group is visible
              const shouldShow = (audioStarted && isAtBottom) || groupVisible;
              // Selected button is always draggable, others need ring visible
              // Before audio starts, don't allow dragging (just clicking to start)
              // During transition, don't allow any dragging
              const isDraggable =
                audioStarted && fadePhase === "idle"
                  ? isAtBottom || (groupVisible && shouldShow)
                  : false;

              return (
                <div
                  className="absolute transition-opacity duration-300"
                  key={set.name}
                  onPointerDown={
                    isDraggable
                      ? (e) => handlePointerDown(e, isAtBottom, index)
                      : undefined
                  }
                  onPointerEnter={
                    audioStarted && isAtBottom && fadePhase === "idle"
                      ? handlePointerEnter
                      : undefined
                  }
                  style={{
                    width: `${BUTTON_RADIUS * 2}px`,
                    height: `${BUTTON_RADIUS * 2}px`,
                    left: "50%",
                    top: "50%",
                    transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) rotate(${itemAngle - Math.PI / 2}rad)`,
                    zIndex: isAtBottom ? 10 : 1,
                    // Selected button visible when audio started, others when group visible
                    opacity: shouldShow ? 1 : 0,
                    pointerEvents:
                      // No pointer events during transition
                      // Selected button has events when idle, others when draggable
                      fadePhase !== "idle"
                        ? "none"
                        : isAtBottom || (isDraggable && groupVisible)
                          ? "auto"
                          : "none",
                  }}
                >
                  <div className="relative h-full w-full overflow-hidden rounded-full bg-[#0A0A0A]/50">
                    {preview ? (
                      <Image
                        alt={label}
                        className="h-full w-full select-none object-cover"
                        draggable={false}
                        fill
                        priority={isAtBottom}
                        sizes={`${BUTTON_RADIUS * 2}px`}
                        src={preview}
                        style={{ pointerEvents: "none" }}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Center logo */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center transition-opacity duration-300"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -40%)",
              opacity:
                audioStarted &&
                fadePhase === "idle" &&
                (isHovered || isSelectedCircleHovered || showRingAfterStart)
                  ? 0.7
                  : 0,
              zIndex: 4,
            }}
          >
            <Image
              alt="Dream Journey"
              className="select-none"
              height={22}
              src="/dream-journey.svg"
              style={{
                pointerEvents: "none",
                transform: "scale(1.6) translateY(-8px)",
              }}
              width={34}
            />
          </div>
        </div>
      )}

      {/* Initial loading overlay */}
      <div
        className="absolute inset-0 z-50 flex flex-col items-center justify-center transition-opacity duration-700"
        style={{
          background: "#0A0A0A",
          pointerEvents: "none",
          opacity:
            isInitialLoading || !minLoadingTimePassed || !audioReady
              ? 1
              : audioStarted
                ? 0
                : 1,
        }}
      >
        {(isInitialLoading ||
          !minLoadingTimePassed ||
          !audioReady ||
          !audioStarted) && (
          <Image
            alt="Dream Journey"
            className="absolute left-1/2 select-none -translate-x-1/2"
            height={12}
            src="/dream-journey-long.svg"
            style={{
              pointerEvents: "none",
              top: "calc(50% - 220px)",
              transform: "translateY(-50%) scale(3.5)",
            }}
            width={64}
          />
        )}

        {(isInitialLoading ||
          !minLoadingTimePassed ||
          !audioReady ||
          !audioStarted) && (
          <div
            className={`pointer-events-none flex flex-col items-center gap-10 transition-opacity duration-400 translate-y-14 ${introFade === "out" ? "opacity-0" : "opacity-100"}`}
          >
            {introStage === 0 ? (
              <div className={`flex flex-col items-center rounded-[14px] px-3 pt-4 pb-4 w-[210px] h-[240px] transition-opacity duration-400 ${animFade === "in" ? "opacity-100" : "opacity-0"}`}>
                <div className="flex justify-center translate-y-2">
                  <PhoneSideIcon />
                </div>
                <div className="mt-auto pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
                  Rotate phone to move
                </div>
              </div>
            ) : (
              <div className={`flex flex-col items-center rounded-[14px] px-3 pt-4 pb-4 w-[210px] h-[240px] transition-opacity duration-400 ${animFade === "in" ? "opacity-100" : "opacity-0"}`}>
                <div className="flex justify-center scale-[1.22] translate-y-8">
                  <DialSideIcon />
                </div>
                <div className="mt-auto pb-1 text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-white/50">
                  Rotate dial to change
                </div>
              </div>
            )}

            {introStage === 0 ? (
              <div
                className={`mt-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80 transition-opacity duration-400 hover:bg-white/10 active:scale-95 ${
                  buttonReady ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
                role="button"
                tabIndex={-1}
                onClick={buttonReady ? handleNextStage : undefined}
              >
                Next
              </div>
            ) : isInitialLoading || !minLoadingTimePassed || !audioReady ? (
              <div
                className={`mt-6 flex h-24 w-24 items-center justify-center text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80 transition-opacity duration-400 ${
                  buttonReady ? "opacity-100" : "opacity-0"
                }`}
              >
                Dreaming
                <span className="inline-block w-[1.5ch] text-left">
                  {".".repeat(dotCount)}
                </span>
              </div>
            ) : audioStarted ? null : (
              <div
                className={`mt-6 flex h-24 w-24 items-center justify-center rounded-full border border-white/20 bg-white/5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80 transition-opacity duration-400 hover:bg-white/10 active:scale-95 ${
                  buttonReady ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
                role="button"
                tabIndex={-1}
                onClick={buttonReady ? startAudio : undefined}
              >
                Enter
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
