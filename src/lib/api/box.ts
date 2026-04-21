const BOX_API = "https://api.box.com/2.0";
const BOX_AUTH = "https://account.box.com/api/oauth2";

export function getBoxAuthUrl(): string {
  const clientId = process.env.BOX_CLIENT_ID;
  if (!clientId) throw new Error("BOX_CLIENT_ID not configured");

  const redirectUri = process.env.BOX_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/box/callback`;

  return `${BOX_AUTH}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const res = await fetch(`${BOX_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.BOX_CLIENT_ID!,
      client_secret: process.env.BOX_CLIENT_SECRET!,
      redirect_uri: process.env.BOX_REDIRECT_URI || `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/api/box/callback`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Box OAuth error: ${err}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}> {
  const res = await fetch(`${BOX_AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.BOX_CLIENT_ID!,
      client_secret: process.env.BOX_CLIENT_SECRET!,
    }),
  });

  if (!res.ok) throw new Error("Failed to refresh Box token");

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

async function boxFetch(accessToken: string, path: string, options?: RequestInit) {
  const res = await fetch(`${BOX_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Box API error (${res.status}): ${err}`);
  }

  return res;
}

export type BoxItem = {
  id: string;
  type: "file" | "folder";
  name: string;
  size?: number;
  modified_at?: string;
  path_collection?: {
    entries: Array<{ id: string; name: string }>;
  };
};

export async function listFolder(accessToken: string, folderId: string = "0", offset = 0, limit = 100): Promise<{
  items: BoxItem[];
  totalCount: number;
}> {
  const res = await boxFetch(accessToken, `/folders/${folderId}/items?fields=id,type,name,size,modified_at,path_collection&offset=${offset}&limit=${limit}`);
  const data = await res.json();
  return {
    items: data.entries,
    totalCount: data.total_count,
  };
}

export async function getFolderInfo(accessToken: string, folderId: string): Promise<{
  id: string;
  name: string;
  path: string;
}> {
  const res = await boxFetch(accessToken, `/folders/${folderId}?fields=id,name,path_collection`);
  const data = await res.json();
  const pathParts = data.path_collection?.entries?.map((e: { name: string }) => e.name) || [];
  return {
    id: data.id,
    name: data.name,
    path: [...pathParts, data.name].join("/"),
  };
}

export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`${BOX_API}/files/${fileId}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Failed to download Box file ${fileId}: ${res.status}`);

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function searchFiles(accessToken: string, query: string, folderId?: string): Promise<BoxItem[]> {
  let url = `/search?query=${encodeURIComponent(query)}&type=file&file_extensions=pdf,xlsx,xls,docx&limit=50`;
  if (folderId) url += `&ancestor_folder_ids=${folderId}`;

  const res = await boxFetch(accessToken, url);
  const data = await res.json();
  return data.entries || [];
}
