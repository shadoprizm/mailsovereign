import * as React from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccountSettings } from "@/features/account/account-settings";
import { AiSettings } from "@/features/billing/ai-settings";
import { DomainSettings } from "@/features/domains/domain-settings";
import { MailboxSettings } from "@/features/mailboxes/mailbox-settings";
import { NativeMailSettings } from "@/features/mailboxes/native-mail-settings";
import type { Mailbox } from "@/features/mailboxes/types";
import { NotificationSettings } from "@/features/notifications/notification-settings";
import type { NotificationController } from "@/features/notifications/types";
import { ProviderConnectionSettings } from "@/features/provider-connections/connection-settings";
import { DebugSettings } from "@/features/settings/debug-settings";
import { SettingsSection } from "@/features/settings/settings-section";
import type { SetupStatus } from "@/features/setup/types";
import type { UpdateStatus } from "@/features/updates/types";
import type { UpdateProgress } from "@/features/updates/update-progress";
import { UpdateSettings } from "@/features/updates/update-settings";
import type { WorkspaceUser } from "@/features/users/types";
import { UserSettings } from "@/features/users/user-settings";
import { sovereignProductConfig } from "@/lib/product-config";
import { appRoutePath, isSettingsTabId, type SettingsTabId } from "@/lib/routes";

const ApplicationSettings = React.lazy(() =>
  import("@/features/transactional/application-settings").then((module) => ({
    default: module.ApplicationSettings
  }))
);

const SignatureSettings = React.lazy(() =>
  import("@/features/signatures/signature-settings").then((module) => ({
    default: module.SignatureSettings
  }))
);

type SettingsPageProps = {
  activeTab: SettingsTabId;
  canManage: boolean;
  isOwner: boolean;
  defaultFromMailboxId: string | null;
  mailboxes: Mailbox[];
  notifications: NotificationController;
  setup: SetupStatus;
  users: WorkspaceUser[];
  onDefaultFromMailboxChange: (mailboxId: string) => void;
  onRefresh: () => void;
  onTabChange: (tab: SettingsTabId) => void;
  onUpdateStarted: (buildId: string) => void;
  onUpdateStatusChange: (status: UpdateStatus) => void;
  updateProgress: UpdateProgress | null;
  updateStatus: UpdateStatus | null;
};

export function SettingsPage({
  activeTab,
  canManage,
  isOwner,
  defaultFromMailboxId,
  mailboxes,
  notifications,
  setup,
  users,
  onDefaultFromMailboxChange,
  onRefresh,
  onTabChange,
  onUpdateStarted,
  onUpdateStatusChange,
  updateProgress,
  updateStatus
}: SettingsPageProps): React.ReactElement {
  const categories: Array<[SettingsTabId, string]> = [
    ["mailboxes", "Mailboxes"],
    ["signatures", "Signatures"],
    ["users", "Users"],
    ...(canManage
      ? ([
          ["domains", "Domains"],
          ["connections", "Connections"],
          ["applications", "Applications"]
        ] as Array<[SettingsTabId, string]>)
      : []),
    ["notifications", "Notifications"],
    ...(canManage && sovereignProductConfig.releaseUpdatesEnabled
      ? ([["updates", "Updates"]] as Array<[SettingsTabId, string]>)
      : []),
    ["ai", "AI"],
    ["account", "Account"],
    ["debug", "Debug"]
  ];
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="hidden mb-7 px-1 sm:px-0 md:block">
          <h1 className="text-xl font-medium tracking-tight">Settings</h1>
          <p className="mt-1 text-xs text-muted-foreground">Workspace and access</p>
        </div>
        <label className="mb-4 grid gap-2 text-sm md:hidden" htmlFor="settings-category">
          Settings category
          <select
            className="min-h-11 w-full rounded-lg border bg-card px-3 text-base"
            id="settings-category"
            value={activeTab}
            onChange={(event) => {
              if (isSettingsTabId(event.target.value)) onTabChange(event.target.value);
            }}
          >
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (isSettingsTabId(value)) onTabChange(value);
          }}
        >
          <TabsList className="hidden h-auto w-full md:flex flex-nowrap justify-start gap-x-1 overflow-x-auto rounded-none border-b bg-transparent p-0 sm:flex-wrap sm:overflow-visible">
            <SettingsTab value="mailboxes">Mailboxes</SettingsTab>
            <SettingsTab value="signatures">Signatures</SettingsTab>
            <SettingsTab value="users">Users</SettingsTab>
            {canManage ? <SettingsTab value="domains">Domains</SettingsTab> : null}
            {canManage ? <SettingsTab value="connections">Connections</SettingsTab> : null}
            {canManage ? <SettingsTab value="applications">Applications</SettingsTab> : null}
            <SettingsTab value="notifications">Notifications</SettingsTab>
            {canManage && sovereignProductConfig.releaseUpdatesEnabled ? (
              <SettingsTab value="updates">Updates</SettingsTab>
            ) : null}
            <SettingsTab value="ai">AI</SettingsTab>
            <SettingsTab value="account">Account</SettingsTab>
            <SettingsTab value="debug">Debug</SettingsTab>
          </TabsList>
          <TabsContent className="mt-5" value="mailboxes">
            <MailboxSettings
              canManage={canManage}
              defaultFromMailboxId={defaultFromMailboxId}
              mailboxes={mailboxes}
              users={users}
              onDefaultFromMailboxChange={onDefaultFromMailboxChange}
              onChanged={onRefresh}
            />
            <NativeMailSettings mailboxes={mailboxes} />
          </TabsContent>
          <TabsContent className="mt-5" value="signatures">
            <React.Suspense
              fallback={<p className="text-sm text-muted-foreground">Loading signatures…</p>}
            >
              <SignatureSettings mailboxes={mailboxes} />
            </React.Suspense>
          </TabsContent>
          <TabsContent className="mt-5" value="users">
            {canManage ? (
              <UserSettings
                managedDomains={setup.domains.map((domain) => domain.name)}
                users={users}
                onChanged={onRefresh}
              />
            ) : (
              <NoUserAccess />
            )}
          </TabsContent>
          {canManage ? (
            <TabsContent className="mt-5" value="domains">
              <DomainSettings portalHostname={setup.portalHostname} onChanged={onRefresh} />
            </TabsContent>
          ) : null}
          {canManage ? (
            <TabsContent className="mt-5" value="connections">
              <ProviderConnectionSettings onMailboxesChanged={onRefresh} />
            </TabsContent>
          ) : null}
          {canManage ? (
            <TabsContent className="mt-5" value="applications">
              <React.Suspense fallback={<p className="text-sm">Loading applications…</p>}>
                <ApplicationSettings />
              </React.Suspense>
            </TabsContent>
          ) : null}
          <TabsContent className="mt-5" value="notifications">
            <NotificationSettings notifications={notifications} />
          </TabsContent>
          {canManage && sovereignProductConfig.releaseUpdatesEnabled ? (
            <TabsContent className="mt-5" value="updates">
              <UpdateSettings
                initialStatus={updateStatus}
                progress={updateProgress}
                onStatusChange={onUpdateStatusChange}
                onUpdateStarted={onUpdateStarted}
              />
            </TabsContent>
          ) : null}
          <TabsContent className="mt-5" value="ai">
            <AiSettings isOwner={isOwner} />
          </TabsContent>
          <TabsContent className="mt-5" value="account">
            <AccountSettings isOwner={isOwner} />
          </TabsContent>
          <TabsContent className="mt-5" value="debug">
            <DebugSettings setup={setup} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SettingsTab({
  children,
  value
}: {
  children: React.ReactNode;
  value: SettingsTabId;
}): React.ReactElement {
  return (
    <TabsTrigger
      asChild
      className="shrink-0 whitespace-nowrap rounded-none border-b border-transparent px-3 py-2 text-xs font-normal text-muted-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
      value={value}
    >
      <a
        href={appRoutePath({ kind: "settings", tab: value })}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
        }}
      >
        {children}
      </a>
    </TabsTrigger>
  );
}

function NoUserAccess(): React.ReactElement {
  return (
    <SettingsSection
      description="Only owner and admin users can manage workspace users."
      title="Users"
    >
      <p className="text-sm text-muted-foreground">
        You can still read and send shared workspace email.
      </p>
    </SettingsSection>
  );
}
