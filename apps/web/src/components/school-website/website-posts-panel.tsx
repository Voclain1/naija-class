"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { WEBSITE_LIMITS, type SchoolWebsiteDto, type WebsitePostDto } from "@school-kit/types";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createWebsitePost,
  deleteWebsitePhoto,
  deleteWebsitePost,
  listWebsitePosts,
  setWebsitePostPublished,
  updateWebsitePost,
} from "@/lib/school-website/school-website-api";

import { SectionLock } from "./section-lock";
import { WebsitePhotoUpload } from "./website-photo-upload";

const TEXTAREA = "min-h-28 w-full rounded-md border border-input bg-background p-2 text-sm";

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

// News on the school's website (docs/modules/school-website.md). Public only:
// a post never reaches parents' phones, which is what announcements are for.
export function WebsitePostsPanel({ site, onChanged }: { site: SchoolWebsiteDto; onChanged: () => void }) {
  const [posts, setPosts] = useState<WebsitePostDto[] | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const state = site.sections.find((s) => s.section === "news")!;

  useEffect(() => {
    listWebsitePosts()
      .then(setPosts)
      .catch(() => setPosts([]));
  }, []);

  const replace = (p: WebsitePostDto) => setPosts((prev) => (prev ?? []).map((x) => (x.id === p.id ? p : x)));

  async function create() {
    setBusy(true);
    try {
      const post = await createWebsitePost({ title, body });
      setPosts((prev) => [post, ...(prev ?? [])]);
      setTitle("");
      setBody("");
      onChanged();
      toast.success("Draft saved. Add photos, then publish it.");
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionLock state={state} enforcement={site.enforcement} />
      <div className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h3 className="font-semibold">Write a post</h3>
        <div className="flex flex-col gap-1">
          <Label htmlFor="post-title">Title</Label>
          <Input id="post-title" maxLength={WEBSITE_LIMITS.postTitle} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Our new science laboratory" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="post-body">Post</Label>
          <textarea id="post-body" className={TEXTAREA} maxLength={WEBSITE_LIMITS.postBody} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">Never name a pupil in a post. This page is public.</p>
        <Button type="button" className="self-start" disabled={busy || !title.trim() || !body.trim()} onClick={() => void create()}>
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save as draft
        </Button>
      </div>

      {posts === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No posts yet.</p>
      ) : (
        posts.map((post) => <PostCard key={post.id} post={post} site={site} onChange={replace} onDeleted={() => setPosts((prev) => (prev ?? []).filter((x) => x.id !== post.id))} onChanged={onChanged} />)
      )}
    </div>
  );
}

function PostCard({
  post,
  site,
  onChange,
  onDeleted,
  onChanged,
}: {
  post: WebsitePostDto;
  site: SchoolWebsiteDto;
  onChange: (p: WebsitePostDto) => void;
  onDeleted: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const down = post.takenDown;
  const maxPhotos = Math.min(WEBSITE_LIMITS.photosPerPost, site.limits.photosPerPost || WEBSITE_LIMITS.photosPerPost);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`flex flex-col gap-3 rounded-lg border p-4 ${down ? "bg-amber-50 dark:bg-amber-950/30" : "bg-card"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{post.title}</h3>
        {down ? <Badge variant="warning">Taken down</Badge> : post.status === "PUBLISHED" ? <Badge variant="success">Published</Badge> : <Badge variant="muted">Draft</Badge>}
      </div>
      {down && <p className="text-sm text-amber-900 dark:text-amber-200">SchoolKit took this post down: {down.reason}. It cannot go back up.</p>}
      {editing ? (
        <div className="flex flex-col gap-2">
          <Input aria-label="Title" maxLength={WEBSITE_LIMITS.postTitle} value={title} onChange={(e) => setTitle(e.target.value)} />
          <textarea aria-label="Post" className={TEXTAREA} maxLength={WEBSITE_LIMITS.postBody} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  onChange(await updateWebsitePost(post.id, { title, body }));
                  setEditing(false);
                })
              }
            >
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm">{post.body}</p>
      )}

      {post.photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {post.photos.map((p) => (
            <figure key={p.id} className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed, short-lived URL */}
              <img src={p.thumbUrl} alt={p.caption ?? ""} className={`h-24 w-32 rounded-md object-cover ${p.takenDown ? "opacity-40" : ""}`} />
              {!down && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await deleteWebsitePhoto(p.id);
                      onChange({ ...post, photos: post.photos.filter((x) => x.id !== p.id) });
                    })
                  }
                >
                  Remove
                </Button>
              )}
            </figure>
          ))}
        </div>
      )}

      {!down && post.photos.length < maxPhotos && (
        <WebsitePhotoUpload kind="POST" postId={post.id} onUploaded={(p) => onChange({ ...post, photos: [...post.photos, p] })} />
      )}

      {!down && (
        <div className="flex flex-wrap gap-2">
          {post.status === "PUBLISHED" ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => onChange(await setWebsitePostPublished(post.id, false)))}>
              Take off the website
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={busy} onClick={() => void run(async () => onChange(await setWebsitePostPublished(post.id, true)))}>
              Publish
            </Button>
          )}
          {!editing && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`Delete “${post.title}” and its photos?`)) return;
              void run(async () => {
                await deleteWebsitePost(post.id);
                onDeleted();
              });
            }}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            Delete
          </Button>
        </div>
      )}
    </article>
  );
}
