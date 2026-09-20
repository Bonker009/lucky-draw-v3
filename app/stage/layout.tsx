import type { Metadata } from "next";

// Distinct titles: the stage, control and setup windows are open side by side
// during the show, and three identically-named entries in the window switcher
// is a real hazard when you are looking for the projector one in a hurry.
export const metadata: Metadata = {
  title: "Stage — Lucky Draw",
};

export default function StageLayout({ children }: LayoutProps<"/stage">) {
  return children;
}
