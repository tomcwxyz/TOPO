export function GET() {
  return Response.json({
    name: "TOPO Cloud", short_name: "topo",
    description: "Keep useful context you choose to share.",
    start_url: "/capture", display: "standalone",
    background_color: "#f5f3ea", theme_color: "#45664f",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    share_target: {
      action: "/share-target", method: "POST", enctype: "multipart/form-data",
      params: { title: "title", text: "text", url: "url" },
    },
  }, { headers: { "Cache-Control": "public, max-age=3600", "Content-Type": "application/manifest+json; charset=utf-8" } });
}
