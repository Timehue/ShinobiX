// Raster alpha masks registered to the existing 1024px painting. The street renders
// its original pixels through each mask, ordered by where the actors' feet land.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const art = new URL('../shinobij.client/public/coast-map/', import.meta.url);
const street = await readFile(new URL('saltstair-landing/scenes/stair-houses-street-v1.webp', art));
if (createHash('sha256').update(street).digest('hex') !== '3e53d7f0c8de882d4395ef44e24ad952af0284b0d551f7a5d08bb6f6fe2e20b7') {
    throw new Error('The street painting changed. Register the silhouettes to its new composition.');
}

const layers = {
    shops: [
        // Provisions shop, roof ridges, lantern and barrels.
        'M77 378 L87 319 125 310 127 281 170 251 178 247 184 251 240 273 245 296 267 299 271 313 305 309 313 323 328 328 331 346 363 350 366 360 374 419 379 428 359 419 359 455 376 459 387 472 385 500 368 510 362 505 361 517 344 521 329 514 315 517 299 514 293 503 279 501 279 509 211 512 211 522 180 525 177 530 149 534 141 530 122 531 116 521 119 501 111 498 113 480 107 476 105 429 92 433 99 393 83 402 Z',
        // Noodle Den, upper roof, awning, benches and nets.
        'M626 394 L634 352 660 344 674 328 716 330 731 320 754 314 768 306 781 301 826 273 830 267 838 269 844 282 903 309 910 331 918 400 902 389 899 444 913 454 917 442 929 451 949 448 956 441 952 483 941 511 922 525 904 523 898 514 885 520 872 517 871 536 815 542 813 521 799 521 798 514 731 517 727 530 661 528 663 510 649 511 647 498 638 498 636 488 624 486 620 472 624 460 609 456 610 425 628 419 631 406 622 406 Z',
    ],
    terrace: [
        // The well, its timber frame, and the jars on the terrace.
        'M125 667 L128 620 130 611 139 607 159 613 173 620 173 628 165 626 162 641 188 639 205 646 211 659 208 689 200 697 153 700 141 693 139 677 Z',
        'M217 692 L222 678 223 670 237 668 245 671 244 679 239 700 250 704 247 687 259 683 271 687 273 697 271 710 258 714 233 706 220 703 Z',
        // Two lanterns flanking the stair up to the market.
        'M373 729 L377 709 381 706 382 694 377 693 381 685 380 680 391 677 395 668 398 668 401 676 412 680 410 686 416 693 407 695 408 705 414 708 420 731 415 748 377 748 Z',
        'M595 729 L601 709 606 707 607 694 600 691 604 685 604 680 615 676 619 668 623 667 627 675 640 680 636 685 643 692 635 696 635 707 642 709 643 732 635 746 598 748 Z',
        // Drying rack beside the right-hand wall.
        'M706 710 L717 660 717 650 724 646 726 650 803 634 807 637 814 689 810 690 803 646 799 646 797 675 791 680 786 676 783 674 779 691 774 691 771 680 765 691 759 687 757 682 751 695 745 694 742 686 735 697 730 691 725 681 713 714 Z',
    ],
    gate: [
        'M326 838 L334 802 375 789 380 786 384 790 386 797 420 804 425 835 435 827 441 827 440 905 405 927 377 931 373 926 363 926 363 900 345 901 345 847 329 848 Z',
        'M571 813 L581 817 586 804 622 791 627 786 632 789 635 797 673 807 679 832 684 842 667 842 667 899 649 902 648 925 616 931 609 925 598 925 595 914 576 898 Z',
    ],
};

async function writeMask(name, body) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">' + body + '</svg>';
    const output = fileURLToPath(new URL('street-' + name + '-mask-v1.webp', art));
    const mask = await sharp(Buffer.from(svg)).resize(name === 'hearth' ? 256 : 512)
        .png({ palette: true, colours: 64, dither: 0 }).toBuffer();
    await sharp(mask).webp({ lossless: true, effort: 6 }).toFile(output);
}

for (const [layer, paths] of Object.entries(layers)) {
    await writeMask(layer, paths.map(d => '<path fill="white" d="' + d + '"/>').join(''));
}
// Fade the light into the original brushwork around the cauldron and its reflected light.
await writeMask('hearth', '<defs><radialGradient id="light"><stop offset=".24" stop-color="white"/>'
    + '<stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs>'
    + '<ellipse cx="518" cy="259" rx="43" ry="28" fill="url(#light)"/>'
    + '<ellipse cx="514" cy="310" rx="45" ry="52" fill="url(#light)"/>');
