import { petCardSealPose, PET_RECALL_SECONDS, PET_SUMMON_SECONDS, type PetCardState } from './pet-summon-presentation';

/** Exact-model atlas fallback for the same physical Beast Seal used in 3D. */
export function drawPetCardSeal(context: CanvasRenderingContext2D, image: HTMLImageElement, state: PetCardState, x: number, footY: number, size: number): void {
    if (state.phase !== 'summon' && state.phase !== 'recall') return;
    const pose = petCardSealPose(state.elapsed / (state.phase === 'recall' ? PET_RECALL_SECONDS : PET_SUMMON_SECONDS), state.phase);
    const unit = size * .3;
    const cardX = x + pose.x * unit, cardY = footY - pose.y * unit;
    context.save();
    if (pose.glow > .001) {
        const color = state.phase === 'recall' ? '245,213,145' : '163,255,229';
        context.globalAlpha = pose.glow;
        const beam = context.createLinearGradient(x, footY, cardX, cardY);
        beam.addColorStop(0, `rgba(${color},.12)`);
        beam.addColorStop(.7, `rgba(${color},.38)`);
        beam.addColorStop(1, `rgba(${color},.08)`);
        context.fillStyle = beam;
        context.beginPath();
        context.moveTo(x - unit * .65, footY); context.lineTo(cardX - unit * .16, cardY);
        context.lineTo(cardX + unit * .16, cardY); context.lineTo(x + unit * .65, footY); context.closePath(); context.fill();
        context.strokeStyle = `rgba(${color},.65)`;
        context.lineWidth = Math.max(1, size * .012);
        context.beginPath(); context.ellipse(x, footY, unit * (1 + pose.glow * .35), unit * .2, 0, 0, Math.PI * 2); context.stroke();
    }
    context.translate(cardX, cardY); context.rotate(-pose.rotation);
    context.globalAlpha = pose.opacity;
    context.drawImage(image, -pose.width * unit / 2, -pose.height * unit / 2, pose.width * unit, pose.height * unit);
    context.restore();
}
