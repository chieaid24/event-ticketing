"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import type {
  CheckInResponse,
  CheckInResult,
  ScanActivityResponse,
  ScanTicketDetail,
} from "@event-ticketing/contracts";

import { AuthApiError } from "../../../../lib/auth-api";
import { decodeQrFrame } from "../../../../lib/qr-decode";
import {
  fetchScanActivity,
  postCheckIn,
  postReversal,
  readScanDeviceId,
} from "../../../../lib/scan-api";

const DECODE_INTERVAL_MS = 250;
/** Ignore camera re-reads of the same code briefly to avoid duplicate posts. */
const RESCAN_HOLD_MS = 4000;
const SAMPLE_WIDTH = 480;

type Tone = "danger" | "success" | "warning";

/**
 * Every outcome pairs color with text, an icon shape, sound, and vibration,
 * so no result relies on color alone.
 */
const resultPresentation: Record<
  CheckInResult,
  { label: string; message: string; tone: Tone }
> = {
  accepted: {
    label: "Admitted",
    message: "Welcome in.",
    tone: "success",
  },
  duplicate: {
    label: "Already checked in",
    message: "This ticket has been used. A supervisor can reverse a mistake.",
    tone: "warning",
  },
  expired: {
    label: "Event ended",
    message: "This event is over, so the ticket no longer admits.",
    tone: "warning",
  },
  invalid: {
    label: "Not recognized",
    message: "This code does not match any ticket for this event.",
    tone: "danger",
  },
  refunded: {
    label: "Refunded ticket",
    message: "This ticket was refunded and does not admit.",
    tone: "danger",
  },
  void: {
    label: "Void ticket",
    message: "This ticket is void and does not admit.",
    tone: "danger",
  },
  wrong_event: {
    label: "Wrong event",
    message: "This ticket belongs to a different event.",
    tone: "warning",
  },
};

type ScanOutcome =
  | { kind: "response"; response: CheckInResponse; scannedAt: Date }
  | { kind: "error"; message: string }
  | { kind: "reversed"; publicNumber: string };

type CameraState = "active" | "starting" | "unavailable";

interface ReversalTarget {
  publicNumber: string;
  ticketId: string;
}

export function ScannerClient({
  apiBaseUrl,
  eventId,
  initialActivity,
  organizationId,
}: Readonly<{
  apiBaseUrl: string;
  eventId: string;
  initialActivity: ScanActivityResponse | null;
  organizationId: string;
}>): ReactNode {
  // Lazy so the id mints once on the client; the empty server value never
  // renders and only delays the camera until hydration.
  const [deviceId] = useState(() =>
    typeof window === "undefined" ? "" : readScanDeviceId()
  );
  const [cameraState, setCameraState] = useState<CameraState>("starting");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [manualNumber, setManualNumber] = useState("");
  const [activity, setActivity] = useState<ScanActivityResponse | null>(
    initialActivity
  );
  const [activityError, setActivityError] = useState(false);
  const [reversalTarget, setReversalTarget] = useState<ReversalTarget | null>(
    null
  );
  const [reversalReason, setReversalReason] = useState("");
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [reversing, setReversing] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ at: number; token: string } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);

  const refreshActivity = useCallback(async () => {
    try {
      setActivity(await fetchScanActivity(apiBaseUrl, organizationId, eventId));
      setActivityError(false);
    } catch {
      setActivityError(true);
    }
  }, [apiBaseUrl, eventId, organizationId]);

  const submit = useCallback(
    async (credential: { publicNumber: string } | { qrToken: string }) => {
      if (busyRef.current || !deviceId) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      try {
        const response = await postCheckIn(
          apiBaseUrl,
          organizationId,
          eventId,
          { credential, deviceId }
        );
        setOutcome({ kind: "response", response, scannedAt: new Date() });
        playFeedback(audioRef, response.result === "accepted");
      } catch (error) {
        setOutcome({
          kind: "error",
          message:
            error instanceof AuthApiError
              ? error.message
              : "The scan failed. Try again.",
        });
        playFeedback(audioRef, false);
      } finally {
        busyRef.current = false;
        setBusy(false);
        void refreshActivity();
      }
    },
    [apiBaseUrl, deviceId, eventId, organizationId, refreshActivity]
  );

  // The camera loop samples frames onto a canvas and decodes them with jsQR.
  // A decoded payload is submitted once and dropped; it never renders.
  useEffect(() => {
    if (!deviceId) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stream: MediaStream | undefined;

    async function start(): Promise<void> {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraState("unavailable");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: "environment" },
        });
      } catch {
        if (!cancelled) {
          setCameraState("unavailable");
        }
        return;
      }
      const video = videoRef.current;
      if (cancelled || !video) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      if (cancelled) {
        return;
      }
      setCameraState("active");
      timer = setInterval(() => {
        if (busyRef.current) {
          return;
        }
        const frameVideo = videoRef.current;
        const canvas = canvasRef.current;
        if (!frameVideo || !canvas || frameVideo.videoWidth === 0) {
          return;
        }
        const scale = SAMPLE_WIDTH / frameVideo.videoWidth;
        canvas.width = SAMPLE_WIDTH;
        canvas.height = Math.round(frameVideo.videoHeight * scale);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) {
          return;
        }
        context.drawImage(frameVideo, 0, 0, canvas.width, canvas.height);
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        const token = decodeQrFrame(frame);
        if (!token) {
          return;
        }
        const now = Date.now();
        const last = lastScanRef.current;
        if (last && last.token === token && now - last.at < RESCAN_HOLD_MS) {
          return;
        }
        lastScanRef.current = { at: now, token };
        void submit({ qrToken: token });
      }, DECODE_INTERVAL_MS);
    }

    void start();
    return () => {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
      }
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [deviceId, submit]);

  function submitManual(formEvent: FormEvent): void {
    formEvent.preventDefault();
    const publicNumber = manualNumber.trim();
    if (!publicNumber) {
      return;
    }
    setManualNumber("");
    void submit({ publicNumber });
  }

  function openReversal(target: ReversalTarget): void {
    setReversalTarget(target);
    setReversalReason("");
    setReversalError(null);
  }

  async function submitReversal(formEvent: FormEvent): Promise<void> {
    formEvent.preventDefault();
    if (!reversalTarget || reversing) {
      return;
    }
    const reason = reversalReason.trim();
    if (reason.length < 5) {
      setReversalError("Give a short reason (at least 5 characters).");
      return;
    }
    setReversing(true);
    try {
      await postReversal(apiBaseUrl, organizationId, eventId, {
        deviceId,
        reason,
        ticketId: reversalTarget.ticketId,
      });
      setOutcome({
        kind: "reversed",
        publicNumber: reversalTarget.publicNumber,
      });
      setReversalTarget(null);
      void refreshActivity();
    } catch (error) {
      setReversalError(
        error instanceof AuthApiError
          ? error.message
          : "The reversal failed. Try again."
      );
    } finally {
      setReversing(false);
    }
  }

  const canReverse = activity?.canReverse ?? false;

  return (
    <div className="scan-shell">
      <section aria-label="Scan result" aria-live="assertive">
        {outcome ? (
          <ResultCard
            canReverse={canReverse}
            onReverse={openReversal}
            outcome={outcome}
          />
        ) : (
          <p className="form-status" role="status">
            Point the camera at a ticket code, or type the ticket number below.
          </p>
        )}
      </section>

      {reversalTarget ? (
        <form className="scan-reverse" onSubmit={submitReversal}>
          <p className="scan-reverse__title">
            Reverse check-in of ticket {reversalTarget.publicNumber}
          </p>
          <div className="form-field">
            <label htmlFor="reversal-reason">Reason</label>
            <input
              id="reversal-reason"
              maxLength={500}
              onChange={(changeEvent) =>
                setReversalReason(changeEvent.target.value)
              }
              type="text"
              value={reversalReason}
            />
          </div>
          {reversalError ? (
            <p className="form-status form-status--error" role="alert">
              {reversalError}
            </p>
          ) : null}
          <div className="scan-reverse__actions">
            <button
              className="button-primary"
              disabled={reversing}
              type="submit"
            >
              {reversing ? "Reversing" : "Confirm reversal"}
            </button>
            <button
              className="button-quiet"
              onClick={() => setReversalTarget(null)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <section aria-label="Camera" className="scan-camera">
        <video
          aria-label="Camera viewfinder"
          className="scan-camera__video"
          muted
          playsInline
          ref={videoRef}
        />
        <canvas aria-hidden="true" hidden ref={canvasRef} />
        {cameraState !== "active" ? (
          <p className="scan-camera__note" role="status">
            {cameraState === "starting"
              ? "Starting the camera."
              : "Camera unavailable. Type the ticket number instead."}
          </p>
        ) : null}
      </section>

      <form
        aria-label="Manual entry"
        className="scan-manual"
        onSubmit={submitManual}
      >
        <div className="form-field scan-manual__field">
          <label htmlFor="manual-ticket-number">Ticket number</label>
          <input
            autoCapitalize="characters"
            autoComplete="off"
            id="manual-ticket-number"
            maxLength={20}
            onChange={(changeEvent) =>
              setManualNumber(changeEvent.target.value)
            }
            placeholder="TK-XXXXXXXXXXXX"
            spellCheck={false}
            type="text"
            value={manualNumber}
          />
        </div>
        <button
          className="button-primary"
          disabled={busy || manualNumber.trim().length === 0}
          type="submit"
        >
          Check in
        </button>
      </form>

      <section aria-label="Recent activity" className="scan-activity">
        <div className="scan-activity__header">
          <h2>Recent activity</h2>
          <button
            className="button-quiet"
            onClick={() => void refreshActivity()}
            type="button"
          >
            Refresh
          </button>
        </div>
        {activityError ? (
          <p className="form-status form-status--error" role="status">
            Recent activity could not be loaded.
          </p>
        ) : null}
        {activity && activity.scans.length === 0 ? (
          <p className="form-status" role="status">
            No scans for this event yet.
          </p>
        ) : null}
        {activity && activity.scans.length > 0 ? (
          <ul className="scan-activity__list">
            {activity.scans.map((entry) => {
              const ticketId = entry.ticketId;
              const publicNumber = entry.ticketPublicNumber;
              return (
                <li className="scan-activity__item" key={entry.id}>
                  <span className="scan-activity__time">
                    {formatTime(entry.createdAt)}
                  </span>
                  <span
                    className="scan-result-badge"
                    data-result={entry.result}
                  >
                    {activityLabel(entry.result)}
                  </span>
                  <span className="scan-activity__detail">
                    {publicNumber ?? "No ticket"}
                    {entry.actorEmail ? ` by ${entry.actorEmail}` : ""}
                    {entry.reason ? ` (${entry.reason})` : ""}
                  </span>
                  {canReverse &&
                  entry.result === "accepted" &&
                  ticketId &&
                  publicNumber ? (
                    <button
                      className="button-quiet"
                      onClick={() => openReversal({ publicNumber, ticketId })}
                      type="button"
                    >
                      Reverse
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function ResultCard({
  canReverse,
  onReverse,
  outcome,
}: Readonly<{
  canReverse: boolean;
  onReverse: (target: ReversalTarget) => void;
  outcome: ScanOutcome;
}>): ReactNode {
  if (outcome.kind === "error") {
    return (
      <div className="scan-result" data-tone="danger">
        <ToneIcon tone="danger" />
        <p className="scan-result__label">Scan failed</p>
        <p className="scan-result__message">{outcome.message}</p>
      </div>
    );
  }
  if (outcome.kind === "reversed") {
    return (
      <div className="scan-result" data-tone="warning">
        <ToneIcon tone="warning" />
        <p className="scan-result__label">Check-in reversed</p>
        <p className="scan-result__message">
          Ticket {outcome.publicNumber} is active again.
        </p>
      </div>
    );
  }

  const { response, scannedAt } = outcome;
  const presentation = resultPresentation[response.result];
  const ticket = response.ticket;

  return (
    <div className="scan-result" data-tone={presentation.tone}>
      <ToneIcon tone={presentation.tone} />
      <p className="scan-result__label">{presentation.label}</p>
      <p className="scan-result__message">
        {response.result === "duplicate" && ticket?.checkedInAt
          ? `Checked in at ${formatTime(ticket.checkedInAt)}.`
          : response.result === "wrong_event" && ticket
            ? `This ticket is for ${ticket.eventTitle}.`
            : presentation.message}
      </p>
      {ticket ? (
        <dl className="scan-result__ticket">
          <div>
            <dt>Ticket</dt>
            <dd>{ticket.publicNumber}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{ticket.ticketTypeName}</dd>
          </div>
          <div>
            <dt>Seat</dt>
            <dd>{seatText(ticket)}</dd>
          </div>
        </dl>
      ) : null}
      <p className="scan-result__meta">Scanned at {formatTime(scannedAt)}</p>
      {canReverse &&
      ticket &&
      (response.result === "accepted" || response.result === "duplicate") ? (
        <button
          className="button-quiet button-quiet--danger"
          onClick={() =>
            onReverse({
              publicNumber: ticket.publicNumber,
              ticketId: ticket.ticketId,
            })
          }
          type="button"
        >
          Reverse this check-in
        </button>
      ) : null}
    </div>
  );
}

function ToneIcon({ tone }: Readonly<{ tone: Tone }>): ReactNode {
  if (tone === "success") {
    return (
      <svg
        aria-hidden="true"
        className="scan-result__icon"
        fill="none"
        viewBox="0 0 48 48"
      >
        <circle cx="24" cy="24" r="21" stroke="currentColor" strokeWidth="3" />
        <path
          d="M15 24.5 21.5 31 33 18"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
      </svg>
    );
  }
  if (tone === "warning") {
    return (
      <svg
        aria-hidden="true"
        className="scan-result__icon"
        fill="none"
        viewBox="0 0 48 48"
      >
        <path
          d="M24 6 45 41H3Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <path
          d="M24 19v10"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="3.5"
        />
        <circle cx="24" cy="35" fill="currentColor" r="2" />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="scan-result__icon"
      fill="none"
      viewBox="0 0 48 48"
    >
      <path
        d="M16 4h16l12 12v16L32 44H16L4 32V16Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="3"
      />
      <path
        d="m17 17 14 14M31 17 17 31"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="3.5"
      />
    </svg>
  );
}

function seatText(ticket: ScanTicketDetail): string {
  if (ticket.sectionName && ticket.seatLabel) {
    return `${ticket.sectionName}, row ${ticket.rowLabel ?? "?"}, seat ${ticket.seatLabel}`;
  }
  return "General admission";
}

function activityLabel(result: string): string {
  if (result === "reversed") {
    return "Reversed";
  }
  const presentation = resultPresentation[result as CheckInResult];
  return presentation ? presentation.label : result;
}

function formatTime(instant: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(instant));
}

/**
 * Audible feedback beside the visual result: rising beeps admit, one low
 * buzz rejects. Failures to play are ignored; sound is reinforcement only.
 */
function playFeedback(
  audioRef: { current: AudioContext | null },
  accepted: boolean
): void {
  try {
    navigator.vibrate?.(accepted ? [60] : [160, 60, 160]);
  } catch {
    // Vibration is optional reinforcement.
  }
  try {
    audioRef.current ??= new AudioContext();
    const context = audioRef.current;
    void context.resume();
    if (accepted) {
      beep(context, 880, 0, 0.1);
      beep(context, 1318, 0.11, 0.12);
    } else {
      beep(context, 196, 0, 0.4, "square");
    }
  } catch {
    // Audio is optional reinforcement.
  }
}

function beep(
  context: AudioContext,
  frequency: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = "sine"
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + startOffset;
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.15, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
}
