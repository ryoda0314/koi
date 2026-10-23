import { Shell } from "./_parts/Shell";

export default function AppLayout({ children }: LayoutProps<"/app">) {
  return <Shell>{children}</Shell>;
}
