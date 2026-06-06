// Open a URL in a new tab via a programmatic anchor click.
//
// Why not window.open(): the download handlers await getReportCardPdfUrl()
// before they have the signed URL, and that await breaks the synchronous
// user-gesture chain — browsers then treat a subsequent window.open() as
// non-user-initiated and silently popup-block it. A programmatic
// <a target="_blank">.click() inside the handler is still treated as direct
// user navigation by all major browsers, so the new tab opens (and the signed
// URL's Content-Disposition: attachment triggers the download).
export function openInNewTab(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}
