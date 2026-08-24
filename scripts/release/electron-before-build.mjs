export default function handleDesktopDependencies() {
  // The desktop shell has no runtime npm dependencies. Prevent electron-builder from collecting
  // the unrelated Worker and web application dependencies from the parent pnpm workspace.
  return false;
}
