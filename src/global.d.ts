declare var _: import('lodash').LoDashStatic;
declare var angular: import('angular').angular.IAngularStatic;
// ace is also there, but we're seeing the latest version, which I'm not sure is what's actually used (the markers API is different)

type RGBColor = [r: number, g: number, b: number];
type HSLColor = [h: number, s: number, l: number];

// alliance-overlay's lift from LOAN
declare function randomColor(opts: {
    hue: "random";
    luminosity: "light";
    seed: string;
    format: "hslArray";
}): HSLColor;

// XXX: not sure what's the story there
declare var GM_xmlhttpRequest = GM.xmlHttpRequest;