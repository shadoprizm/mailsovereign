import * as React from "react";

import { cn } from "@/lib/cn";

const TableLabels = React.createContext<string[]>([]);

function nodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node))
    return nodeText(node.props.children);
  return React.Children.toArray(node).map(nodeText).join(" ");
}

function headerLabels(node: React.ReactNode): string[] {
  return React.Children.toArray(node).flatMap((child) => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return [];
    if (child.type === TableHead) return [nodeText(child.props.children).trim() || "Actions"];
    return headerLabels(child.props.children);
  });
}

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  containerClassName?: string;
};

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <TableLabels.Provider value={headerLabels(children)}>
      <div
        className={cn("relative w-full overflow-auto", containerClassName)}
        data-slot="table-container"
      >
        <table
          className={cn("w-full caption-bottom text-sm", className)}
          data-slot="table"
          ref={ref}
          {...props}
        >
          {children}
        </table>
      </div>
    </TableLabels.Provider>
  )
);
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead className={cn("[&_tr]:border-b", className)} ref={ref} {...props} />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody className={cn("[&_tr:last-child]:border-0", className)} ref={ref} {...props} />
));
TableBody.displayName = "TableBody";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, children, ...props }, ref) => {
  const labels = React.useContext(TableLabels);
  const cells = React.Children.toArray(children).filter(React.isValidElement);
  return (
    <tr
      className={cn(
        "border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted/50",
        className
      )}
      ref={ref}
      {...props}
    >
      {cells.map((cell, index) =>
        React.isValidElement<
          React.TdHTMLAttributes<HTMLTableCellElement> & { "data-label"?: string }
        >(cell) &&
        cell.type === TableCell &&
        !cell.props.colSpan
          ? React.cloneElement(cell, { "data-label": labels[index] ?? "" })
          : cell
      )}
    </tr>
  );
});
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    className={cn("h-10 px-3 text-left align-middle font-medium text-muted-foreground", className)}
    ref={ref}
    {...props}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td className={cn("px-3 py-2 align-middle", className)} ref={ref} {...props} />
));
TableCell.displayName = "TableCell";
