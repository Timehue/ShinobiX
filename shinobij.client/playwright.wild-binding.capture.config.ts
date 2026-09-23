import base from './playwright.wild-binding.config';

/** Record the real 3D binding sequence at the desktop viewport. */
export default {
    ...base,
    outputDir: 'test-results/wild-binding-capture',
    use: { ...base.use, video: { mode: 'on' as const, size: { width: 1366, height: 768 } } },
    projects: base.projects?.filter((project) => project.name === 'chromium-desktop'),
};
