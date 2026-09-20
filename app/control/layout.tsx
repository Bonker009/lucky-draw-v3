import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Control — Lucky Draw",
};

export default function ControlLayout({ children }: LayoutProps<"/control">) {
  return children;
}
