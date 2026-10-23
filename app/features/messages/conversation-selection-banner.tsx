import type { ConversationSelection } from "./conversation-selection";

export function ConversationSelectionBanner({
  selection,
  loadedCount
}: {
  selection: ConversationSelection;
  loadedCount: number;
}): React.ReactElement | null {
  if (!selection.selectionMode) return null;
  const canExpand =
    loadedCount > 0 &&
    selection.selectedConversations.length === loadedCount &&
    (selection.totalCount ?? 0) > loadedCount;
  if (!selection.allMatching && !canExpand) return null;
  return (
    <div className="shrink-0 border-b bg-primary/5 px-3 py-2 text-center text-xs" role="status">
      <p>
        {selection.allMatching
          ? `All ${selection.totalCount?.toLocaleString() ?? "matching"} conversations in this view are selected.`
          : `${loadedCount} loaded conversations selected.`}
      </p>
      {selection.allMatching ? (
        <>
          <p className="mt-1 text-muted-foreground">
            Choose mark as read or unread to update the entire selection.
          </p>
          <button
            className="mt-1 font-medium text-primary underline underline-offset-2"
            disabled={selection.bulkPending}
            type="button"
            onClick={() => selection.toggleAll(false)}
          >
            Clear selection
          </button>
        </>
      ) : (
        <button
          className="mt-1 font-medium text-primary underline underline-offset-2"
          disabled={selection.bulkPending}
          type="button"
          onClick={selection.selectAllMatching}
        >
          Select all {selection.totalCount?.toLocaleString()} conversations
        </button>
      )}
    </div>
  );
}
