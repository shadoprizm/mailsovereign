import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import type { MailFolderId } from "@/lib/routes";
import type { ConversationFilterApiParams } from "./conversation-filters";
import type {
  ConversationAction,
  ConversationPage,
  MessageDetail,
  MessageHtml,
  MessageSummary
} from "./types";

export type MessageListParams = {
  cursor?: string | undefined;
  folder?: string | undefined;
  labelId?: string | undefined;
  mailboxId?: string | undefined;
  search?: string | undefined;
};

export async function listMessages(params: MessageListParams): Promise<MessageSummary[]> {
  const query = new URLSearchParams();
  if (params.folder) query.set("folder", params.folder);
  if (params.mailboxId) query.set("mailboxId", params.mailboxId);
  if (params.labelId) query.set("labelId", params.labelId);
  if (params.search) query.set("search", params.search);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return apiGet<MessageSummary[]>(`/api/messages${suffix}`);
}

export async function listConversations(
  params: MessageListParams & ConversationFilterApiParams & { folder: MailFolderId }
): Promise<ConversationPage> {
  const query = new URLSearchParams({ folder: params.folder });
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.mailboxId) query.set("mailboxId", params.mailboxId);
  if (params.labelId) query.set("labelId", params.labelId);
  if (params.search) query.set("search", params.search);
  if (params.after) query.set("after", params.after);
  if (params.attachments) query.set("attachments", params.attachments);
  if (params.before) query.set("before", params.before);
  if (params.contains) query.set("contains", params.contains);
  if (params.direction) query.set("direction", params.direction);
  if (params.exclude) query.set("exclude", params.exclude);
  if (params.from) query.set("from", params.from);
  if (params.read) query.set("read", params.read);
  if (params.starred) query.set("starred", params.starred);
  if (params.subject) query.set("subject", params.subject);
  if (params.to) query.set("to", params.to);
  return apiGet<ConversationPage>(`/api/conversations?${query.toString()}`);
}

export async function getMessage(id: string): Promise<MessageDetail> {
  return apiGet<MessageDetail>(`/api/messages/${id}`);
}

export async function getMessageThread(id: string): Promise<MessageDetail[]> {
  return apiGet<MessageDetail[]>(`/api/messages/${id}/thread`);
}

export async function getMessageHtml(id: string, loadRemoteImages = false): Promise<MessageHtml> {
  const suffix = loadRemoteImages ? "?loadRemoteImages=1" : "";
  return apiGet<MessageHtml>(`/api/messages/${id}/html${suffix}`);
}

export async function trustRemoteMediaSender(id: string): Promise<void> {
  await apiPost(`/api/messages/${id}/remote-media/trust`);
}

export async function runMessageAction(
  id: string,
  action: "read" | "unread" | "star" | "unstar" | "archive" | "trash"
): Promise<MessageSummary> {
  return apiPost<MessageSummary>(`/api/messages/${id}/${action}`);
}

export async function runConversationAction(
  id: string,
  action: ConversationAction,
  folder: MailFolderId
): Promise<{ affected: number; threadId: string }> {
  return apiPost(`/api/conversations/${id}/${action}`, { folder });
}

export async function deleteConversation(
  id: string
): Promise<{ affected: number; threadId: string }> {
  return apiDelete(`/api/conversations/${id}`);
}

export type ConversationSelectionScope = Omit<MessageListParams, "cursor" | "folder"> &
  ConversationFilterApiParams & { folder: MailFolderId };

export async function setMatchingConversationsReadState(
  filters: ConversationSelectionScope,
  action: "read" | "unread"
): Promise<{ affected: number; conversationCount: number }> {
  return apiPost("/api/conversations/bulk-read-state", { action, filters });
}
