import { createPlugin } from "@app/lib/api/poke/types";
import { Authenticator } from "@app/lib/auth";
import { ProjectTodoResource } from "@app/lib/resources/project_todo_resource";
import { getIdsFromSId } from "@app/lib/resources/string_ids";
import { WorkspaceResource } from "@app/lib/resources/workspace_resource";
import { Err, Ok } from "@app/types/shared/result";

export const projectTodoDetailsPlugin = createPlugin({
  manifest: {
    id: "project-todo-details",
    name: "Project TODO Details",
    description:
      "Display all related objects for a Project TODO (sources, conversations, etc.)",
    resourceTypes: ["workspaces"],
    readonly: true,
    args: {
      todoId: {
        type: "string",
        label: "Project TODO sId",
        description: "The sId of the Project TODO to inspect",
      },
    },
  },
  execute: async (_auth, workspace, args) => {
    if (!workspace) {
      return new Err(new Error("Workspace not found."));
    }

    // The sId encodes the workspace — decode it so we can scope auth correctly
    // regardless of which workspace the poke admin currently has open.
    const idsRes = getIdsFromSId(args.todoId);
    if (idsRes.isErr()) {
      return new Err(new Error(`Invalid Project TODO sId: ${args.todoId}`));
    }

    const ws = await WorkspaceResource.fetchByModelIds([
      idsRes.value.workspaceModelId,
    ]);
    if (ws.length === 0) {
      return new Err(
        new Error(`Workspace not found for Project TODO sId: ${args.todoId}`)
      );
    }

    const todoAuth = await Authenticator.internalAdminForWorkspace(ws[0].sId);

    const todo = await ProjectTodoResource.fetchBySId(todoAuth, args.todoId);
    if (!todo) {
      return new Err(new Error(`Project TODO not found: ${args.todoId}`));
    }

    const [sourcesMap, conversationsMap] = await Promise.all([
      ProjectTodoResource.fetchSourcesForTodoIds(todoAuth, {
        sIds: [args.todoId],
      }),
      ProjectTodoResource.fetchConversationIdsForTodoIds(todoAuth, {
        sIds: [args.todoId],
      }),
    ]);

    const sources = sourcesMap.get(args.todoId) ?? [];
    const conversationId = conversationsMap.get(args.todoId) ?? null;

    const statusEmoji: Record<string, string> = {
      todo: "⬜",
      in_progress: "🔄",
      done: "✅",
    };

    const sourcesSection =
      sources.length === 0
        ? "_No sources._"
        : sources
            .map((s) => {
              const link = s.sourceUrl ? ` ([link](${s.sourceUrl}))` : "";
              return `- **${s.sourceType}** — ${s.sourceTitle ?? s.sourceId}${link}`;
            })
            .join("\n");

    const conversationSection = conversationId
      ? `\`${conversationId}\``
      : "_No linked conversation._";

    const doneAt = todo.doneAt ? new Date(todo.doneAt).toISOString() : "—";
    const createdAt = new Date(todo.createdAt).toISOString();

    return new Ok({
      display: "markdown",
      value: `## ${statusEmoji[todo.status] ?? "❓"} Project TODO \`${todo.sId}\`

**Text:** ${todo.text}

| Field | Value |
|---|---|
| Status | \`${todo.status}\` |
| Created by | \`${todo.createdByType}\` |
| Created at | ${createdAt} |
| Done at | ${doneAt} |

## Sources (${sources.length})

${sourcesSection}

## Linked Conversation

${conversationSection}
`,
    });
  },
});
