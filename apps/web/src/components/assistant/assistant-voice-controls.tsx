"use client";

import { Mic, MicOff, PhoneOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { normaliseVoiceProviderEvent, type VoiceSessionStartDto } from "@school-kit/types";
import { Button } from "@/components/ui/button";
import { assistantVoiceApi } from "@/lib/assistant/voice-api";

/**
 * Realtime voice transport UI. No microphone access before a user click.
 * No browser speech-recognition fallback, persistence or analytics.
 * Transcripts are passed to the parent Assistant for its shared conversation.
 */
export function AssistantVoiceControls({ onTranscript }: { onTranscript: (text: string, sessionId: string) => Promise<{ turnId: string; token: string; text: string } | null> }) {
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "listening" | "user-speaking" | "thinking" | "speaking" | "error">("idle");
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const session = useRef<VoiceSessionStartDto | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const track = useRef<MediaStreamTrack | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const connecting = useRef(false);
  const playback = useRef<HTMLAudioElement | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const processing = useRef(false);
  const interrupted = useRef(false);
  const connectingGeneration = useRef(0);

  useEffect(() => {
    let alive = true;
    if (typeof RTCPeerConnection === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    void assistantVoiceApi.capabilities().then((cap) => {
      if (alive) setAvailable(cap.available && cap.transports.includes("webrtc"));
    }).catch(() => { if (alive) setAvailable(false); });
    return () => { alive = false; };
  }, []);

  const stop = useCallback(() => {
    if (heartbeat.current) clearInterval(heartbeat.current);
    heartbeat.current = null;
    connectingGeneration.current += 1;
    interrupted.current = true;
    speechAbort.current?.abort();
    speechAbort.current = null;
    playback.current?.pause();
    if (playback.current?.src.startsWith("blob:")) URL.revokeObjectURL(playback.current.src);
    playback.current = null;
    track.current?.stop();
    track.current = null;
    peer.current?.close();
    peer.current = null;
    const id = session.current?.session.sessionId;
    session.current = null;
    connecting.current = false;
    setMuted(false);
    setConnected(false);
    setRemaining(null);
    setCaption("");
    setPhase("idle");
    if (id) void assistantVoiceApi.end(id).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    // Stop capture synchronously on unmount, including account/school change.
    speechAbort.current?.abort();
    playback.current?.pause();
    track.current?.stop();
    peer.current?.close();
    if (heartbeat.current) clearInterval(heartbeat.current);
    if (session.current) void assistantVoiceApi.end(session.current.session.sessionId).catch(() => undefined);
  }, []);

  const processTranscript = useCallback(async (text: string) => {
    const id = session.current?.session.sessionId;
    if (!id || processing.current) return;
    processing.current = true;
    interrupted.current = false;
    setPhase("thinking");
    try {
      const speech = await onTranscript(text, id);
      if (!speech || interrupted.current || session.current?.session.sessionId !== id) return;
      const controller = new AbortController();
      speechAbort.current = controller;
      const response = await assistantVoiceApi.speech(id, { turnId: speech.turnId, token: speech.token, text: speech.text }, controller.signal);
      const blob = await response.blob();
      if (controller.signal.aborted || interrupted.current || session.current?.session.sessionId !== id) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      playback.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); playback.current = null; setPhase("listening"); };
      audio.onerror = () => { URL.revokeObjectURL(url); playback.current = null; setError("Could not play the voice reply. The text reply is available."); setPhase("listening"); };
      setPhase("speaking");
      await audio.play();
    } catch {
      if (session.current && !interrupted.current) setError("Spoken reply unavailable. The text reply is still in the conversation.");
    } finally {
      processing.current = false;
      if (session.current && !playback.current) setPhase("listening");
    }
  }, [onTranscript]);

  const start = useCallback(async () => {
    if (connecting.current || session.current) return;
    connecting.current = true;
    const generation = ++connectingGeneration.current;
    setError("");
    setPhase("connecting");
    try {
      const started = await assistantVoiceApi.start();
      if (generation !== connectingGeneration.current) {
        void assistantVoiceApi.end(started.session.sessionId).catch(() => undefined);
        return;
      }
      session.current = started;
      setConnected(true);
      setRemaining(started.session.usage.secondsRemaining);
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (generation !== connectingGeneration.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      const audioTrack = mic.getAudioTracks()[0];
      if (!audioTrack) throw new Error("Microphone not available");
      track.current = audioTrack;
      const pc = new RTCPeerConnection();
      peer.current = pc;
      pc.addTrack(audioTrack, mic);
      const dc = pc.createDataChannel(started.credential.dataChannel);
      dc.onmessage = (message) => {
        try {
          const event = normaliseVoiceProviderEvent(JSON.parse(message.data));
          if (event.type === "speech.started") {
            if (playback.current || processing.current) {
              interrupted.current = true;
              speechAbort.current?.abort();
              playback.current?.pause();
              if (playback.current?.src.startsWith("blob:")) URL.revokeObjectURL(playback.current.src);
              playback.current = null;
              void assistantVoiceApi.interrupt(started.session.sessionId, { at: processing.current ? "thinking" : "speaking" }).catch(() => undefined);
            }
            setPhase("user-speaking");
          }
          if (event.type === "speech.stopped") setPhase("listening");
          if (event.type === "transcript.delta") setCaption((v) => v + event.text);
          if (event.type === "transcript.final") {
            setCaption("");
            if (event.text.trim() && session.current) void processTranscript(event.text.trim());
          }
          if (event.type === "transcript.failed") setCaption("I didn't catch that. Please try again.");
          if (event.type === "provider.error") {
            setError("Voice connection interrupted. Continue using text chat.");
            stop();
          }
        } catch {
          // Ignore unknown provider events, never render untrusted wire data.
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          setError("Voice disconnected. You can continue typing.");
          stop();
        }
      };
      await pc.setLocalDescription(await pc.createOffer());
      const response = await fetch(started.credential.connectUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${started.credential.clientSecret}`, "Content-Type": "application/sdp" },
        body: pc.localDescription?.sdp ?? "",
      });
      if (!response.ok) throw new Error("Could not establish voice connection");
      const answer = await response.text();
      if (generation !== connectingGeneration.current) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answer });
      heartbeat.current = setInterval(() => {
        if (session.current) void assistantVoiceApi.heartbeat(session.current.session.sessionId)
          .then((updated) => {
            if (updated.status !== "ACTIVE") { setError("Voice session ended. Continue in text chat."); stop(); return; }
            setRemaining(updated.usage.secondsRemaining);
          }).catch(() => { stop(); setError("Voice session lost. Continue in text chat."); });
      }, Math.max(5, started.limits.heartbeatSeconds) * 1000);
      setPhase("listening");
    } catch {
      if (generation === connectingGeneration.current) {
        stop();
        setError("Voice is unavailable. You can continue with text chat.");
      }
    } finally {
      connecting.current = false;
    }
  }, [processTranscript, stop]);

  if (!available) return null;
  return (
    <section aria-label="Voice assistant" className="border-t border-border px-4 py-2">
      <div className="flex items-center gap-2">
        {!connected ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void start()} disabled={phase === "connecting"}>
            {phase === "connecting" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            {phase === "connecting" ? "Connecting…" : "Start voice"}
          </Button>
        ) : (
          <>
            <span role="status" className="mr-auto text-xs text-muted-foreground">{muted ? "Muted" : phase === "speaking" ? "Assistant speaking…" : phase === "thinking" ? "Thinking…" : "Voice connected"}</span>
            <Button type="button" variant="outline" size="sm" aria-label={muted ? "Unmute microphone" : "Mute microphone"} onClick={() => {
              if (!track.current) return;
              track.current.enabled = muted;
              setMuted(!muted);
            }}>{muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}</Button>
            <Button type="button" variant="outline" size="sm" onClick={stop} aria-label="End voice session"><PhoneOff className="h-4 w-4" /></Button>
          </>
        )}
      </div>
      {connected && remaining !== null && remaining < 120 && <p role="status" className="mt-2 text-xs text-muted-foreground">About {Math.max(1, Math.ceil(remaining / 60))} minute(s) remaining</p>}
      {caption && <p role="status" className="mt-2 text-xs text-muted-foreground">{caption}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}
