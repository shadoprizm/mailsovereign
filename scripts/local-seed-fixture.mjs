import { insert, messageColumns, messageValues, upsert } from "./local-seed-sql.mjs";
import { buildSeedTimeline } from "./local-seed-timeline.mjs";

const seedVersion = "local-demo-v1";
const owner = {
  id: "usr_local_owner",
  email: "owner@sovereign-mail.test",
  name: "Local Owner"
};
const domain = {
  id: "dom_local_demo",
  name: "example.test"
};
const mailboxes = [
  {
    id: "mbx_local_support",
    addressId: "addr_local_support",
    address: "support@example.test",
    displayName: "Support"
  },
  {
    id: "mbx_local_sales",
    addressId: "addr_local_sales",
    address: "sales@example.test",
    displayName: "Sales"
  }
];

export function buildSeedSql(passwordHash, seedDate = new Date()) {
  const timeline = buildSeedTimeline(seedDate);
  const lines = [
    "PRAGMA foreign_keys = ON;",
    upsert(
      '"user"',
      ["id", "name", "email", "emailVerified", "createdAt", "updatedAt", "role", "banned"],
      [owner.id, owner.name, owner.email, 1, timeline.workspaceCreated, timeline.now, "owner", 0],
      ["id"],
      ["name", "email", "emailVerified", "updatedAt", "role", "banned"]
    ),
    upsert(
      "account",
      [
        "id",
        "issuer",
        "providerAccountId",
        "providerId",
        "userId",
        "password",
        "createdAt",
        "updatedAt"
      ],
      [
        "acc_local_owner",
        "local:credential",
        owner.id,
        "credential",
        owner.id,
        passwordHash,
        timeline.workspaceCreated,
        timeline.now
      ],
      ["id"],
      ["password", "updatedAt"]
    ),
    upsert(
      "mail_domains",
      [
        "id",
        "name",
        "receiving_status",
        "sending_status",
        "dns_status",
        "catch_all_policy",
        "is_enabled",
        "verified_at",
        "created_at",
        "updated_at"
      ],
      [
        domain.id,
        domain.name,
        "ready",
        "ready",
        "ready",
        "reject",
        1,
        timeline.workspaceCreated,
        timeline.workspaceCreated,
        timeline.now
      ],
      ["id"],
      [
        "name",
        "receiving_status",
        "sending_status",
        "dns_status",
        "catch_all_policy",
        "is_enabled",
        "verified_at",
        "updated_at"
      ]
    )
  ];

  for (const mailbox of mailboxes) {
    lines.push(
      upsert(
        "mailboxes",
        ["id", "address", "display_name", "is_active", "created_at", "updated_at"],
        [
          mailbox.id,
          mailbox.address,
          mailbox.displayName,
          1,
          timeline.workspaceCreated,
          timeline.now
        ],
        ["id"],
        ["address", "display_name", "is_active", "updated_at"]
      ),
      upsert(
        "mailbox_addresses",
        [
          "id",
          "mailbox_id",
          "mail_domain_id",
          "local_part",
          "address",
          "display_name",
          "receive_enabled",
          "send_enabled",
          "is_primary",
          "created_at",
          "updated_at"
        ],
        [
          mailbox.addressId,
          mailbox.id,
          domain.id,
          mailbox.address.split("@")[0],
          mailbox.address,
          mailbox.displayName,
          1,
          1,
          1,
          timeline.workspaceCreated,
          timeline.now
        ],
        ["id"],
        [
          "mailbox_id",
          "mail_domain_id",
          "local_part",
          "address",
          "display_name",
          "receive_enabled",
          "send_enabled",
          "is_primary",
          "updated_at"
        ]
      )
    );
  }

  lines.push(
    upsert(
      "mailbox_grants",
      ["mailbox_id", "user_id", "access_level", "created_by", "created_at", "updated_at"],
      [mailboxes[1].id, owner.id, "manager", owner.id, timeline.workspaceCreated, timeline.now],
      ["mailbox_id", "user_id"],
      ["access_level", "updated_at"]
    ),
    upsert(
      "user_mail_preferences",
      ["user_id", "default_from_mailbox_id", "created_at", "updated_at"],
      [owner.id, mailboxes[0].id, timeline.workspaceCreated, timeline.now],
      ["user_id"],
      ["default_from_mailbox_id", "updated_at"]
    ),
    upsert(
      "app_settings",
      ["key", "value_json", "created_at", "updated_at"],
      ["primary_domain", JSON.stringify(domain.name), timeline.workspaceCreated, timeline.now],
      ["key"],
      ["value_json", "updated_at"]
    ),
    upsert(
      "app_settings",
      ["key", "value_json", "created_at", "updated_at"],
      ["setup_complete", JSON.stringify(true), timeline.workspaceCreated, timeline.now],
      ["key"],
      ["value_json", "updated_at"]
    ),
    upsert(
      "app_settings",
      ["key", "value_json", "created_at", "updated_at"],
      [
        "setup_checklist_acknowledged",
        JSON.stringify(true),
        timeline.workspaceCreated,
        timeline.now
      ],
      ["key"],
      ["value_json", "updated_at"]
    ),
    upsert(
      "app_settings",
      ["key", "value_json", "created_at", "updated_at"],
      ["local_seed_version", JSON.stringify(seedVersion), timeline.workspaceCreated, timeline.now],
      ["key"],
      ["value_json", "updated_at"]
    )
  );

  lines.push(
    insert(
      "threads",
      ["id", "subject_normalized", "last_message_at", "created_at", "updated_at"],
      [
        "thr_local_project",
        "project update",
        timeline.projectReply,
        timeline.projectReceived,
        timeline.projectReply
      ]
    ),
    insert(
      "threads",
      ["id", "subject_normalized", "last_message_at", "created_at", "updated_at"],
      [
        "thr_local_invoice",
        "august invoice",
        timeline.invoiceReceived,
        timeline.invoiceReceived,
        timeline.invoiceReceived
      ]
    ),
    insert(
      "threads",
      ["id", "subject_normalized", "last_message_at", "created_at", "updated_at"],
      [
        "thr_local_sales",
        "sales follow up",
        timeline.salesReceived,
        timeline.salesReceived,
        timeline.salesArchived
      ]
    )
  );

  lines.push(
    insert(
      "messages",
      messageColumns,
      messageValues(
        {
          id: "msg_local_project_inbound",
          threadId: "thr_local_project",
          mailboxId: mailboxes[0].id,
          direction: "inbound",
          folder: "inbox",
          from: "alex@customer.test",
          to: [mailboxes[0].address],
          subject: "Project update",
          snippet: "The project is on track for Friday.",
          text: "Hi team,\n\nThe project is on track for Friday. I will send the final notes tomorrow.",
          messageId: "<local-project-inbound@example.test>",
          dedupeKey: "local-project-inbound",
          receivedAt: timeline.projectReceived,
          deliveredToAddressId: mailboxes[0].addressId
        },
        timeline.now
      )
    ),
    insert(
      "messages",
      messageColumns,
      messageValues(
        {
          id: "msg_local_project_reply",
          threadId: "thr_local_project",
          mailboxId: mailboxes[0].id,
          direction: "outbound",
          folder: "sent",
          from: mailboxes[0].address,
          to: ["alex@customer.test"],
          subject: "Re: Project update",
          snippet: "Thanks, we will watch for the final notes.",
          text: "Thanks, we will watch for the final notes.",
          messageId: "<local-project-reply@example.test>",
          dedupeKey: "local-project-reply",
          inReplyTo: "<local-project-inbound@example.test>",
          references: ["<local-project-inbound@example.test>"],
          sentAt: timeline.projectReply,
          readAt: timeline.projectReply,
          sentFromAddressId: mailboxes[0].addressId
        },
        timeline.now
      )
    ),
    insert(
      "messages",
      messageColumns,
      messageValues(
        {
          id: "msg_local_invoice",
          threadId: "thr_local_invoice",
          mailboxId: mailboxes[0].id,
          direction: "inbound",
          folder: "inbox",
          from: "billing@vendor.test",
          to: [mailboxes[0].address],
          subject: "August invoice",
          snippet: "Your August invoice is ready for review.",
          text: "Your August invoice is ready for review. The due date is August 31.",
          messageId: "<local-invoice@example.test>",
          dedupeKey: "local-invoice",
          receivedAt: timeline.invoiceReceived,
          starredAt: timeline.invoiceStarred,
          deliveredToAddressId: mailboxes[0].addressId
        },
        timeline.now
      )
    ),
    insert(
      "messages",
      messageColumns,
      messageValues(
        {
          id: "msg_local_sales",
          threadId: "thr_local_sales",
          mailboxId: mailboxes[1].id,
          direction: "inbound",
          folder: "archived",
          from: "partner@business.test",
          to: [mailboxes[1].address],
          subject: "Sales follow up",
          snippet: "Following up on our conversation.",
          text: "Following up on our conversation from last week.",
          messageId: "<local-sales@example.test>",
          dedupeKey: "local-sales",
          receivedAt: timeline.salesReceived,
          readAt: timeline.salesRead,
          archivedAt: timeline.salesArchived,
          deliveredToAddressId: mailboxes[1].addressId
        },
        timeline.now
      )
    ),
    insert(
      "drafts",
      [
        "id",
        "user_id",
        "mailbox_id",
        "reply_to_message_id",
        "from_address",
        "to_json",
        "cc_json",
        "bcc_json",
        "subject",
        "text_body",
        "html_body",
        "version",
        "created_at",
        "updated_at",
        "forward_of_message_id"
      ],
      [
        "drf_local_followup",
        owner.id,
        mailboxes[0].id,
        null,
        mailboxes[0].address,
        ["alex@customer.test"],
        [],
        [],
        "Project follow-up",
        "I wanted to follow up on the final notes.",
        "",
        1,
        timeline.draftCreated,
        timeline.draftUpdated,
        null
      ]
    )
  );

  return `${lines.join("\n")}\n`;
}
