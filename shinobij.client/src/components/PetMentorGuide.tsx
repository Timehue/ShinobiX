import { useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Character } from "../types/character";
import type { Screen } from "../types/core";
import { Modal } from "./ui/Modal";
import tomoePortrait from "../assets/pet-mentor/tomoe-portrait.webp";
import kuroPortrait from "../assets/pet-mentor/kuro-portrait.webp";
import tomoePrologue from "../assets/pet-mentor/tomoe-prologue.webp";
import tomoeFinale from "../assets/pet-mentor/tomoe-finale.webp";
import { openPetArenaView } from "../lib/pet-arena-navigation";
import {
    PET_TUTORIAL_LESSONS,
    completePetTutorialLesson,
    nextPetTutorialLesson,
    normalizePetTutorialProgress,
    personalizePetTutorialText,
    petTutorialCompletion,
    petTutorialLessonAvailable,
    type PetTutorialLesson,
    type PetTutorialLessonId,
    type PetTutorialProgress,
} from "../lib/pet-tutorial";
import { PET_MENTOR_NAME } from "../lib/pet-tutorial-mentor";
import "../styles/pet-mentor-guide.css";

type PetMentorGuideProps = {
    open: boolean;
    character: Character;
    onClose: () => void;
    onProgress: (progress: PetTutorialProgress) => void;
    setScreen: (screen: Screen) => void;
    initialLessonId?: PetTutorialLessonId;
    returnFocusRef?: RefObject<HTMLElement | null>;
};

function initialLesson(character: Character, requested?: PetTutorialLessonId): PetTutorialLesson {
    const requestedLesson = PET_TUTORIAL_LESSONS.find((lesson) => lesson.id === requested);
    if (requestedLesson && petTutorialLessonAvailable(requestedLesson, character)) return requestedLesson;
    return nextPetTutorialLesson(character)
        ?? [...PET_TUTORIAL_LESSONS].reverse().find((lesson) => petTutorialLessonAvailable(lesson, character))
        ?? PET_TUTORIAL_LESSONS[0];
}

function lockLabel(lesson: PetTutorialLesson, character: Character): string {
    const needs: string[] = [];
    if (character.level < lesson.minLevel) needs.push(`level ${lesson.minLevel}`);
    if (character.pets.length < lesson.minPets) needs.push(`${lesson.minPets} pets`);
    return needs.length ? `Needs ${needs.join(" and ")}` : "Ready";
}

function storyBeat(completed: number, total: number) {
    if (completed === 0) return {
        kicker: "Field chronicle · Prologue",
        title: "A trail found at blue hour",
        body: "Kuro caught your companion's scent three roads back. His own second tail lifted while he followed it, an old habit since his Bondwake. Tomoe wants to compare notes before either of you mistakes attention for practice.",
        image: tomoePrologue,
        imageAlt: "Tamer Tomoe and Kuro studying a fresh trail beside their lantern-lit road camp.",
        finale: false,
    };
    if (completed < Math.ceil(total / 2)) return {
        kicker: "Field chronicle · The road",
        title: "The bell between lessons",
        body: "Each chapter you finish discussing earns one ring of Tomoe's brass bell. She marks the questions you carried forward and leaves the performance claims blank for the field to answer.",
        image: tomoePrologue,
        imageAlt: "Tamer Tomoe and Kuro keeping watch beside their lantern-lit road camp.",
        finale: false,
    };
    if (completed < total) return {
        kicker: "Field chronicle · The last pages",
        title: "A camp packed lighter",
        body: "Only the last chapters remain. Tomoe has rolled the spare maps; Kuro waits at the ridge path. They will leave after the reading, and the practice will still be yours to do.",
        image: tomoePrologue,
        imageAlt: "Tamer Tomoe and Kuro preparing for the final lessons at their forest-road camp.",
        finale: false,
    };
    return {
        kicker: "Field chronicle · Epilogue",
        title: "The bell at dawn",
        body: "Tomoe leaves the field journal in your keeping. Kuro looks back once from the ridge. Their notes end here. Your next test begins when a real field decision refuses to match the page.",
        image: tomoeFinale,
        imageAlt: "Tamer Tomoe and Kuro departing at dawn after leaving a brass bell and field journal by the road.",
        finale: true,
    };
}

export function PetMentorGuide({
    open,
    character,
    onClose,
    onProgress,
    setScreen,
    initialLessonId,
    returnFocusRef,
}: PetMentorGuideProps) {
    const [lessonId, setLessonId] = useState<PetTutorialLessonId>(() => initialLesson(character, initialLessonId).id);
    const [pageIndex, setPageIndex] = useState(0);
    const [localProgress, setLocalProgress] = useState(() => normalizePetTutorialProgress(character.petTutorialProgress));
    const titleId = useId();
    const descriptionId = useId();
    const lessonTitleId = useId();
    const pageTitleId = useId();
    const activeLessonButtonRef = useRef<HTMLButtonElement>(null);
    const lessonScrollRef = useRef<HTMLElement>(null);

    const lesson = PET_TUTORIAL_LESSONS.find((entry) => entry.id === lessonId) ?? PET_TUTORIAL_LESSONS[0];
    const page = lesson.pages[Math.min(pageIndex, lesson.pages.length - 1)];
    const isLastPage = pageIndex >= lesson.pages.length - 1;
    const completed = new Set(localProgress.completedLessonIds);
    const completion = petTutorialCompletion(localProgress);
    const chronicle = storyBeat(completion.completed, completion.total);
    const lessonComplete = completed.has(lesson.id);
    const availableLessons = PET_TUTORIAL_LESSONS.filter((entry) => petTutorialLessonAvailable(entry, character));
    const nextIncompleteLesson = availableLessons.find((entry) => entry.id !== lesson.id && !completed.has(entry.id)) ?? null;

    useEffect(() => {
        activeLessonButtonRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
    }, [lessonId]);

    useEffect(() => {
        lessonScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    }, [lessonId, pageIndex]);

    function selectLesson(next: PetTutorialLesson) {
        if (!petTutorialLessonAvailable(next, character)) return;
        setLessonId(next.id);
        setPageIndex(0);
    }

    function markComplete(): PetTutorialProgress {
        const next = completePetTutorialLesson(localProgress, lesson.id);
        setLocalProgress(next);
        onProgress(next);
        return next;
    }

    function goToPractice() {
        if (!lessonComplete) markComplete();
        onClose();
        if (lesson.destination.kind === "arena") {
            openPetArenaView(lesson.destination.view, setScreen, character.activePetId);
            return;
        }
        setScreen(lesson.destination.screen);
    }

    function finishAndContinue() {
        const nextProgress = markComplete();
        const next = availableLessons.find((entry) => !nextProgress.completedLessonIds.includes(entry.id));
        if (!next) return;
        setLessonId(next.id);
        setPageIndex(0);
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            bare
            size="lg"
            ariaLabelledBy={titleId}
            ariaDescribedBy={descriptionId}
            backdropClassName="pet-mentor-backdrop"
            className="pet-mentor-modal"
            returnFocusRef={returnFocusRef}
        >
            <div className="pet-mentor-guide">
                <header className="pet-mentor-hero">
                    <div className="pet-mentor-portraits" aria-hidden="true">
                        <img src={tomoePortrait} alt="" />
                        <img src={kuroPortrait} alt="" />
                    </div>
                    <div className="pet-mentor-hero-copy">
                        <span className="pet-mentor-kicker">Wandering beastmaster · persistent field course</span>
                        <h2 id={titleId}>{PET_MENTOR_NAME} &amp; Kuro</h2>
                        <p id={descriptionId}>Seven complete lessons, delivered when your level and roster can actually use them. Review any unlocked chapter whenever you need it.</p>
                    </div>
                    <button type="button" className="pet-mentor-close" onClick={onClose} aria-label="Close Tomoe's field guide">×</button>
                    <div
                        className="pet-mentor-progress"
                        role="progressbar"
                        aria-label="Pet battle course completion"
                        aria-valuemin={0}
                        aria-valuemax={completion.total}
                        aria-valuenow={completion.completed}
                        aria-valuetext={`${completion.completed} of ${completion.total} lessons complete`}
                    >
                        <span><strong>{completion.completed}</strong> / {completion.total} lessons</span>
                        <span className="pet-mentor-progress-track" aria-hidden="true"><span style={{ width: `${completion.percent}%` }} /></span>
                    </div>
                </header>

                <div className="pet-mentor-layout">
                    <p className="pet-mentor-sr-only" role="status" aria-live="polite" aria-atomic="true">
                        Lesson {lesson.order} of {PET_TUTORIAL_LESSONS.length}: {lesson.title}. Page {pageIndex + 1} of {lesson.pages.length}: {page.title}.
                    </p>
                    <nav className="pet-mentor-curriculum" aria-label="Pet battle lessons">
                        {PET_TUTORIAL_LESSONS.map((entry) => {
                            const unlocked = petTutorialLessonAvailable(entry, character);
                            const done = completed.has(entry.id);
                            return (
                                <button
                                    type="button"
                                    key={entry.id}
                                    className={`${entry.id === lesson.id ? "is-active" : ""}${done ? " is-complete" : ""}`}
                                    ref={entry.id === lesson.id ? activeLessonButtonRef : undefined}
                                    aria-disabled={!unlocked}
                                    onClick={() => selectLesson(entry)}
                                    aria-current={entry.id === lesson.id ? "step" : undefined}
                                >
                                    <span className="pet-mentor-chapter-number">{done ? "✓" : entry.order.toString().padStart(2, "0")}</span>
                                    <span><strong>{entry.shortTitle}</strong><small>{unlocked ? entry.eyebrow : lockLabel(entry, character)}</small></span>
                                    {!unlocked ? <span className="pet-mentor-lock" aria-hidden="true">▣</span> : null}
                                </button>
                            );
                        })}
                    </nav>

                    <section ref={lessonScrollRef} className="pet-mentor-lesson" aria-labelledby={lessonTitleId}>
                        <div className="pet-mentor-lesson-topline">
                            <span>{lesson.eyebrow}</span>
                            <span>Page {pageIndex + 1} of {lesson.pages.length}</span>
                        </div>
                        <h3 id={lessonTitleId}>{lesson.title}</h3>
                        <p className="pet-mentor-summary">{lesson.summary}</p>

                        <figure className={`pet-mentor-story${chronicle.finale ? " is-finale" : ""}`}>
                            <img src={chronicle.image} alt={chronicle.imageAlt} />
                            <figcaption>
                                <span>{chronicle.kicker}</span>
                                <strong>{chronicle.title}</strong>
                                <p>{chronicle.body}</p>
                            </figcaption>
                        </figure>

                        <div className="pet-mentor-page-dots" aria-label="Lesson pages">
                            {lesson.pages.map((entry, index) => (
                                <button
                                    type="button"
                                    key={entry.title}
                                    className={index === pageIndex ? "is-active" : index < pageIndex ? "is-read" : ""}
                                    onClick={() => setPageIndex(index)}
                                    aria-label={`Page ${index + 1}: ${entry.title}`}
                                    aria-current={index === pageIndex ? "step" : undefined}
                                />
                            ))}
                        </div>

                        <article className="pet-mentor-page" aria-labelledby={pageTitleId}>
                            <span>{page.kicker}</span>
                            <h4 id={pageTitleId}>{page.title}</h4>
                            <p>{personalizePetTutorialText(page.body, character)}</p>
                            <ul>
                                {page.points.map((point) => <li key={point}>{personalizePetTutorialText(point, character)}</li>)}
                            </ul>
                            {page.callout ? <blockquote>{personalizePetTutorialText(page.callout, character)}</blockquote> : null}
                        </article>

                        <footer className="pet-mentor-actions">
                            <button type="button" className="pet-mentor-secondary" disabled={pageIndex === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>← Previous</button>
                            <span className="pet-mentor-level-note">Unlock: level {lesson.minLevel}{lesson.minPets > 1 ? ` · ${lesson.minPets} pets` : ""}</span>
                            {!isLastPage ? (
                                <button type="button" className="pet-mentor-primary" onClick={() => setPageIndex((page) => Math.min(lesson.pages.length - 1, page + 1))}>Next lesson page →</button>
                            ) : (
                                <div className="pet-mentor-final-actions">
                                    {!lessonComplete ? <button type="button" className="pet-mentor-secondary" onClick={finishAndContinue}>{nextIncompleteLesson ? "Complete lesson & continue" : "Complete lesson"}</button> : null}
                                    <button type="button" className="pet-mentor-primary" onClick={goToPractice}>{lessonComplete ? lesson.practiceLabel : `Complete & ${lesson.practiceLabel}`} →</button>
                                </div>
                            )}
                        </footer>
                    </section>
                </div>
            </div>
        </Modal>
    );
}
