type Team = "blue" | "red";

const TEAM_COLOR: Record<Team, string> = { blue: "#3bc5ff", red: "#ff536f" };

const ELEMENT_COLOR: Readonly<Record<string, string>> = {
    fire: "#ff704a",
    water: "#49c9ff",
    wind: "#71f5d0",
    lightning: "#ffe168",
    earth: "#d6a76a",
    shadow: "#bd7bff",
};

export { type Team, TEAM_COLOR, ELEMENT_COLOR };
