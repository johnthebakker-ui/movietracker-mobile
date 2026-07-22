import { firstRow } from "../../app/media-model";
import type { UserList } from "../../app/types";
import { tmdbImage } from "../../config";
import { supabase } from "../../supabase";

export async function loadUserLists(userId: string): Promise<UserList[]> {
  const client = supabase;
  if (!client) return [];
  const { data: rawLists, error: listError } = await client.from("lists").select("id,name,description,visibility,cover_url,featured_media_id").eq("user_id", userId).order("name", { ascending: true });
  if (listError) throw listError;
  const lists = rawLists ?? [];
  if (!lists.length) return [];
  const featuredIds = lists.flatMap((list: any) => list.featured_media_id ? [list.featured_media_id] : []);
  const [featuredResult, itemResult] = await Promise.all([
    featuredIds.length ? client.from("media").select("id,poster_path,backdrop_path,title").in("id", featuredIds) : Promise.resolve({ data: [] }),
    client.from("list_items").select("list_id,position,media(id,poster_path,backdrop_path,title)").in("list_id", lists.map((list: any) => list.id)).order("position", { ascending: true })
  ]);
  if ((featuredResult as any).error) throw (featuredResult as any).error;
  if ((itemResult as any).error) throw (itemResult as any).error;
  const featuredById = new Map((featuredResult.data ?? []).map((media: any) => [media.id, media]));
  const itemsByList = new Map<string, any[]>();
  for (const item of itemResult.data ?? []) itemsByList.set(item.list_id, [...(itemsByList.get(item.list_id) ?? []), item]);
  return lists.map((list: any) => {
    const listItems = itemsByList.get(list.id) ?? [];
    const featured: any = list.featured_media_id ? featuredById.get(list.featured_media_id) : null;
    const featuredPoster = tmdbImage(featured?.backdrop_path || featured?.poster_path, "w500");
    const posters = listItems.slice(0, 4).flatMap((item: any) => {
      const media = firstRow<any>(item.media);
      const poster = tmdbImage(media?.poster_path || media?.backdrop_path, "w342");
      return poster ? [poster] : [];
    });
    return { id: list.id, name: list.name, description: list.description, visibility: list.visibility, cover_url: list.cover_url, count: listItems.length, posters: list.cover_url ? [list.cover_url] : featuredPoster ? [featuredPoster, ...posters].slice(0, 4) : posters };
  });
}
