import "./globals.css";
import { ServiceWorkerRegistration } from "./service-worker-registration.jsx";

export const metadata = {
  title: "TOPO Cloud — capture",
  description: "Keep useful context from across your tools, on your terms.",
  manifest: "/manifest.webmanifest",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return <html lang="en-GB">
    <body>
      <ServiceWorkerRegistration />
      {children}
    </body>
  </html>;
}
