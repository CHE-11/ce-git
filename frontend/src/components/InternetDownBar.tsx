import { useOnline } from "../lib/use-online";

export function InternetDownBar() {
  const online = useOnline();
  if (online) {
    return null;
  }

  return (
    <p
      id="internet-down"
      role="alert"
      className="border-b border-red-900 bg-red-950/60 px-3 py-2 text-sm text-red-300"
    >
      Internet is down
    </p>
  );
}
