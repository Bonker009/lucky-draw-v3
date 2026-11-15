"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { DrawState } from "@/lib/domain/types";
import {
  clampGroup,
  groupCount,
  groupSlice,
  PHOTO_GROUP_SIZE,
  photoRoster,
  type PhotoState,
} from "@/lib/stage/photo-session";
import { BlurFade } from "@/components/ui/blur-fade";

export const ROSTER_ALL = "all";

/** Reading pace, in CSS pixels per second. Slow enough to scan by. */
const SCROLL_SPEED = 42;
/** Hold at each end so the first and last names are readable, not glimpsed. */
const EDGE_PAUSE_MS = 2600;
/** Names listed in "still waiting for …" before it says "and N more". */
const WAITING_SHOWN = 4;

/**
 * Column count and type size.
 *
 * The list shares the screen with the prize panel, so three columns is the
 * most it takes — four in two-thirds of the width truncates ordinary names.
 * Very short lists stay in one column, where spreading three names across
 * several leaves a mostly empty board and reads as a mistake.
 *
 * The size is chosen purely for legibility from the back of the room; a group
 * is at most ten, so the names never have to shrink to fit.
 */
function layoutFor(count: number) {
  if (count <= 4) return { columns: 1, size: "clamp(2.75rem, 8.5vh, 6rem)" };
  if (count <= 10) return { columns: 2, size: "clamp(2rem, 5.5vh, 4rem)" };
  return { columns: 3, size: "clamp(1.4rem, 3.8vh, 2.4rem)" };
}

/**
 * The photo-call board: the winners of a prize on screen, for the group photo.
 *
 * One screen used to do three jobs. It is now two modes the presenter switches
 * from the remote (or B on the stage):
 *
 * - **Call up.** Numbered names, so the host can call "one through eight" and
 *   people find themselves. Each name goes quiet with a tick as that person is
 *   checked in, so the room — and the host — can see who is still missing. A
 *   big prize is called in groups of ten rather than as a list that scrolls
 *   past: people were waiting for their name to come round again.
 * - **Backdrop.** Once the group is up, the screen is behind their heads and
 *   bodies cover the lower two-thirds. Everything that matters — the event,
 *   the prize, "Winners" — sits in the top third; the rest is left calm. No
 *   name list: in the photo it was only names sliced by shoulders.
 *
 * Check-in is presentation state (`lib/stage/photo-session.ts`), never logged.
 */
export function PhotoCall({
  state,
  scope,
  prizeImageUrl,
  photo,
  reducedMotion = false,
}: {
  state: DrawState;
  /** A prize id, or ROSTER_ALL. */
  scope: string;
  prizeImageUrl: string | null;
  photo: PhotoState;
  reducedMotion?: boolean;
}) {
  const isAll = scope === ROSTER_ALL;
  const prize = isAll ? undefined : state.prizesById.get(scope);
  const title = isAll ? "All winners" : (prize?.name ?? "Winners");
  const roster = useMemo(() => photoRoster(state, scope, ROSTER_ALL), [scope, state]);
  const total = roster.length;
  const groups = groupCount(total);
  const group = clampGroup(photo.group, total);
  const shown = useMemo(() => groupSlice(roster, group), [roster, group]);
  const nextUp = groupSlice(roster, group + 1);

  if (photo.mode === "backdrop") {
    return (
      <Backdrop
        title={title}
        eventName={state.settings.eventName}
        total={total}
        prizeImageUrl={isAll ? null : prizeImageUrl}
      />
    );
  }

  return (
    <CallUp
      title={title}
      total={total}
      shown={shown}
      nextUp={group + 1 < groups ? nextUp : []}
      group={group}
      groups={groups}
      here={photo.here}
      absent={photo.absent}
      prizeImageUrl={isAll ? null : prizeImageUrl}
      reducedMotion={reducedMotion}
    />
  );
}

function CallUp({
  title,
  total,
  shown,
  nextUp,
  group,
  groups,
  here,
  absent,
  prizeImageUrl,
  reducedMotion,
}: {
  title: string;
  total: number;
  shown: ReturnType<typeof photoRoster>;
  nextUp: ReturnType<typeof photoRoster>;
  group: number;
  groups: number;
  here: string[];
  absent: string[];
  prizeImageUrl: string | null;
  reducedMotion: boolean;
}) {
  const scrollRef = useRef<HTMLOListElement>(null);
  const layout = layoutFor(shown.length);
  const hereSet = new Set(here);
  const absentSet = new Set(absent);
  const expected = shown.filter((r) => !absentSet.has(r.participantId));
  const arrived = expected.filter((r) => hereSet.has(r.participantId)).length;
  const waiting = expected.filter((r) => !hereSet.has(r.participantId));
  const checking = here.length > 0 || absent.length > 0;

  // Whether the list is taller than its box. A short list is centred and left
  // unmasked; the edge fade is only for names scrolling in and out, and on a
  // list that fits it just dimmed the first row for no reason.
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown.length, layout.columns]);

  // A group of ten fits, but a very short screen may not: then it scrolls,
  // gently, paused at both ends, rather than clipping the tail.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || reducedMotion) return;
    let raf = 0;
    let last = performance.now();
    let direction: 1 | -1 = 1;
    let pausedUntil = performance.now() + EDGE_PAUSE_MS;
    let position = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow > 1 && now >= pausedUntil) {
        position += direction * SCROLL_SPEED * dt;
        if (position >= overflow) {
          position = overflow;
          direction = -1;
          pausedUntil = now + EDGE_PAUSE_MS;
        } else if (position <= 0) {
          position = 0;
          direction = 1;
          pausedUntil = now + EDGE_PAUSE_MS;
        }
        el.scrollTop = position;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, shown.length, layout.columns, group]);

  const from = group * PHOTO_GROUP_SIZE + 1;
  const to = from + shown.length - 1;

  return (
    // Prize on the left, winners on the right: the prize is what the photo is
    // of, and giving it its own column lets the image be big enough to see.
    <section
      className="grid h-full w-full grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)] gap-[3vw] px-[3vw] py-[2.5vh]"
      aria-labelledby="photo-call-heading"
    >
      <header className="flex min-h-0 flex-col items-center justify-center gap-[1.5vh] border-r border-gold/15 pr-[3vw] text-center">
        <p className="stage-label text-gold">Photo session</p>
        {prizeImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB, downscaled on upload
          <img
            src={prizeImageUrl}
            alt=""
            className="aspect-square min-h-0 w-full max-w-[44vh] shrink rounded-3xl object-cover ring-1 ring-gold/40"
          />
        ) : null}
        <h1
          id="photo-call-heading"
          className="text-balance text-[clamp(1.75rem,4.5vh,3.5rem)] font-semibold leading-tight text-gold"
        >
          {title}
        </h1>
        <p className="text-[clamp(0.95rem,2vh,1.4rem)] text-ink-300">
          {total} {total === 1 ? "winner" : "winners"}
        </p>

        {/* Check-in progress for the group being called. Only once the host
            has started checking people in: before that it is noise. */}
        {checking ? (
          <div className="mt-[1vh] flex w-full max-w-[44vh] flex-col gap-[1vh]" role="status">
            <p className="text-[clamp(1rem,2.4vh,1.6rem)] text-ink-300">
              <span className="font-semibold text-ink-100 tabular-nums">
                {arrived} of {expected.length}
              </span>{" "}
              on stage
            </p>
            <div aria-hidden className="flex gap-1">
              {shown.map((r) => (
                <span
                  key={r.participantId}
                  className={`h-1.5 flex-1 rounded-full ${
                    hereSet.has(r.participantId)
                      ? "bg-ink-100"
                      : absentSet.has(r.participantId)
                        ? "bg-ink-100/5"
                        : "bg-ink-100/20"
                  }`}
                />
              ))}
            </div>
            <p className="line-clamp-2 text-[clamp(0.85rem,1.8vh,1.2rem)] text-ink-500">
              {waiting.length === 0
                ? "Everyone is here — ready for the photo."
                : `Still waiting for ${waiting
                    .slice(0, WAITING_SHOWN)
                    .map((r) => r.name)
                    .join(", ")}${waiting.length > WAITING_SHOWN ? ` and ${waiting.length - WAITING_SHOWN} more` : ""}`}
            </p>
          </div>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-col justify-center gap-[2.5vh]">
        <p className="shrink-0 text-[clamp(1rem,2.4vh,1.6rem)] text-ink-500">
          {groups > 1 ? (
            <>
              <span className="font-semibold text-ink-100">
                Group {group + 1} of {groups}
              </span>{" "}
              · numbers {from}–{to} · please come up to the stage
            </>
          ) : (
            "See your name? Please come up to the stage."
          )}
        </p>

        {total === 0 ? (
          <p className="text-center text-ink-500">No winners drawn for this prize yet.</p>
        ) : (
          <ol
            ref={scrollRef}
            className={`grid min-h-0 w-full gap-x-[2vw] gap-y-[0.5vh] overflow-y-hidden ${
              overflowing ? "reel-mask content-start" : "content-center"
            } ${layout.columns === 1 ? "justify-items-center" : ""}`}
            style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}
          >
            {shown.map((r, i) => {
              const isHere = hereSet.has(r.participantId);
              const isAbsent = absentSet.has(r.participantId);
              return (
                <li key={`${group}-${r.participantId}`} className="min-w-0">
                  {/* Names arrive top to bottom as the group opens, so it
                      reads down the list in order. */}
                  <BlurFade
                    delay={i * 0.04}
                    duration={0.45}
                    className="flex min-w-0 items-baseline gap-[1vw]"
                  >
                    <span
                      className="shrink-0 text-right tabular-nums text-gold/60"
                      style={{ fontSize: `calc(${layout.size} * 0.45)`, width: "2.6em" }}
                    >
                      {r.n}
                    </span>
                    {/* Checked in: the name goes quiet, so the ones still
                        missing are what the eye lands on. */}
                    <span
                      className={`min-w-0 flex-1 truncate font-semibold transition-colors duration-500 ${
                        isHere
                          ? "text-ink-500"
                          : isAbsent
                            ? "text-ink-500/50 line-through decoration-2"
                            : "text-ink-100"
                      }`}
                      style={{ fontSize: layout.size }}
                    >
                      {r.name}
                    </span>
                    {/* A tick, not a labelled pill: the pill took enough of the
                        column to cut the checked-in name to "Guest 0…". */}
                    {isHere ? (
                      <span className="grid size-[1.6em] shrink-0 place-items-center self-center rounded-full bg-ink-100/10 text-[clamp(0.9rem,2vh,1.3rem)] text-ink-300">
                        <Check aria-hidden className="size-[0.9em]" />
                        <span className="sr-only">On stage</span>
                      </span>
                    ) : isAbsent ? (
                      <span className="shrink-0 self-center text-[clamp(0.8rem,1.6vh,1.1rem)] text-ink-500">
                        Not here
                      </span>
                    ) : null}
                  </BlurFade>
                </li>
              );
            })}
          </ol>
        )}

        {/* The next group can line up while this one is photographed. */}
        {nextUp.length > 0 ? (
          <p className="shrink-0 truncate text-[clamp(0.9rem,2vh,1.3rem)] text-ink-500">
            <span className="mr-[1vw] text-[0.8em] font-medium uppercase tracking-[0.12em]">
              Get ready · group {group + 2}
            </span>
            {nextUp.map((r) => r.name).join(" · ")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Backdrop({
  title,
  eventName,
  total,
  prizeImageUrl,
}: {
  title: string;
  eventName: string;
  total: number;
  prizeImageUrl: string | null;
}) {
  return (
    <section
      aria-labelledby="photo-call-heading"
      className="relative flex h-full w-full flex-col items-center px-[4vw] pt-[6vh]"
    >
      <BlurFade className="flex flex-col items-center gap-[2.2vh] text-center">
        {eventName ? (
          <p className="text-[clamp(0.9rem,2vh,1.4rem)] font-medium uppercase tracking-[0.2em] text-ink-500">
            {eventName}
          </p>
        ) : null}
        <div className="flex items-center gap-[3vw]">
          {prizeImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL from IndexedDB, downscaled on upload
            <img
              src={prizeImageUrl}
              alt=""
              className="aspect-[4/3] h-[18vh] shrink-0 rounded-[1.4vw] object-cover shadow-[0_2vh_6vh_rgb(0_0_0/0.5)] ring-1 ring-ink-100/10"
            />
          ) : null}
          <h1
            id="photo-call-heading"
            className="flex flex-col text-left text-[clamp(2.5rem,10vh,8rem)] font-semibold leading-[0.95] tracking-[-0.045em]"
          >
            <span className="text-ink-100">{title}</span>
            {/* Gold: these people are the winners. */}
            <span className="text-gold-bright [text-shadow:0_0_6vh_rgb(242_214_138/0.3)]">
              Winners
            </span>
          </h1>
        </div>
        <p className="flex items-center gap-[1vw] text-[clamp(1rem,2.4vh,1.6rem)] text-ink-500">
          <span aria-hidden className="h-px w-[3vw] bg-gold/50" />
          {total} {total === 1 ? "winner" : "winners"}
          <span aria-hidden className="h-px w-[3vw] bg-gold/50" />
        </p>
      </BlurFade>
      {/* The lower two-thirds is behind the group: left calm on purpose. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: "linear-gradient(180deg, transparent, rgb(40 20 48 / 0.45))" }}
      />
    </section>
  );
}
