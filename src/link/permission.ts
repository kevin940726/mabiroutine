export type LinkPermission = "granted" | "prompt" | "denied" | "unsupported";
export type BlockedPermission = "prompt" | "denied";

function status(): Promise<PermissionStatus | null> {
  if (typeof navigator === "undefined" || !navigator.permissions) return Promise.resolve(null);
  try {
    return navigator.permissions.query({
      name: "local-network-access" as unknown as PermissionName,
    });
  } catch {
    return Promise.resolve(null);
  }
}

export async function linkPermission(): Promise<LinkPermission> {
  try {
    const permission = await status();
    return permission ? permission.state : "unsupported";
  } catch {
    return "unsupported";
  }
}

export async function watchLinkPermission(
  onChange: (state: LinkPermission) => void
): Promise<() => void> {
  try {
    const permission = await status();
    if (!permission) return () => {};
    const handler = () => onChange(permission.state);
    permission.onchange = handler;
    handler();
    return () => {
      if (permission.onchange === handler) permission.onchange = null;
    };
  } catch {
    return () => {};
  }
}
