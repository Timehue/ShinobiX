import {expect,test} from "@playwright/test";

test("rotated phones keep the garden, eight pets and active attacks below the HUD",async({page},info)=>{
    test.skip(info.project.name!=="desktop");
    test.setTimeout(180_000);
    for(const viewport of [{width:844,height:390},{width:1040,height:480}]) {
        await page.setViewportSize(viewport);
        await page.goto("/petvfx.html?rite=1&riteqa=1&ritemotionqa=1&ritegroundingqa=1&seed=23&ritespeed=.75&petQuality=high");
        await page.getByRole("button",{name:"Lock formation",exact:true}).click();
        await expect(page.getByTestId("wfr-stage-curtain")).toHaveCSS("opacity","0",{timeout:90_000});
        const canvas=page.locator("canvas[data-rite-terrain]");
        await expect(canvas).toHaveAttribute("data-rite-arena","training-garden-v1");
        await expect(canvas).toHaveAttribute("data-rite-actors-in-safe-viewport","8");
        const hud=await page.locator(".wfr-hud").boundingBox();
        expect(hud!.height).toBeLessThan(145);
        await expect.poll(async()=>Number(await page.getByTestId("wfr-clock").getAttribute("data-tick"))).toBeGreaterThan(90);
        await page.screenshot({path:info.outputPath(`garden-${viewport.width}x${viewport.height}.png`)});
    }
});
