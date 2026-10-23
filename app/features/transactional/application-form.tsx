import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ServiceApplication } from "./types";

export function ApplicationForm({
  application,
  busy,
  onSave
}: {
  application?: ServiceApplication;
  busy: boolean;
  onSave: (input: {
    name: string;
    description: string;
    status: string;
    perMinute: number;
    perDay: number;
  }) => void;
}) {
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave({
          name: String(data.get("name")),
          description: String(data.get("description")),
          status: String(data.get("status") ?? "active"),
          perMinute: Number(data.get("perMinute")),
          perDay: Number(data.get("perDay"))
        });
      }}
    >
      <label htmlFor="app-name" className="grid gap-1 text-sm">
        Application name
        <Input
          id="app-name"
          name="name"
          required
          maxLength={100}
          defaultValue={application?.name}
        />
      </label>
      <label htmlFor="app-description" className="grid gap-1 text-sm">
        Description
        <Input
          id="app-description"
          name="description"
          maxLength={1000}
          defaultValue={application?.description}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label htmlFor="app-perMinute" className="grid gap-1 text-sm">
          Messages per minute
          <Input
            type="number"
            id="app-perMinute"
            name="perMinute"
            required
            min={1}
            max={1000}
            defaultValue={application?.per_minute ?? 30}
          />
        </label>
        <label htmlFor="app-perDay" className="grid gap-1 text-sm">
          Messages per day (UTC)
          <Input
            type="number"
            id="app-perDay"
            name="perDay"
            required
            min={1}
            max={100000}
            defaultValue={application?.per_day ?? 500}
          />
        </label>
      </div>
      {application ? (
        <label className="grid gap-1 text-sm">
          Status
          <select
            className="rounded-md border bg-background p-2"
            name="status"
            defaultValue={application.status}
          >
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="revoked">Revoked permanently</option>
          </select>
        </label>
      ) : null}
      <Button className="w-fit" disabled={busy || application?.status === "revoked"} type="submit">
        {application ? "Save application" : "Create application"}
      </Button>
    </form>
  );
}
