import type { MetadataRoute } from "next";
import { PAGES, SITE } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(([p]) => ({ url: SITE.url + (p === "/" ? "" : p), lastModified: new Date() }));
}
