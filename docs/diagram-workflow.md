# Diagram Authoring Workflow

The diagram workflow is an offline content pipeline. It does not call AI while a
user opens a problem in the Companion view.

## Chosen API And Models

- Provider: Coze / 扣子 workflow by default.
- Upload endpoint: `POST https://api.coze.cn/v1/files/upload`.
- Workflow endpoint: `POST https://api.coze.cn/v1/workflow/run`.
- Vision node: configure inside Coze with a multimodal model that supports image
  input and structured output.
- Compiler node: configure inside Coze with a JSON-stable text model and a fixed
  diagram-layout output schema.
- Output constraint: Coze workflow node schema plus LeetcodeUltra local schema
  and semantic validation.
- Runtime fallback: original problem image.

The important choice is to put the agentic part in Coze, not in this repository.
LeetcodeUltra only uploads the source image, runs a published workflow, wraps the
returned diagram layout with local problem metadata, validates the resulting
`DiagramPack`, and writes it to `resources/diagrams/`.

## Pipeline

1. Collect local problem metadata and the source image.
2. Upload the local image to Coze and pass the returned file id into the workflow
   as a JSON string such as `{"file_id":"..."}`.
3. Run the Coze workflow:
   - vision evidence node extracts visible rows/text/uncertainty,
   - compiler node emits only the diagram layout JSON,
   - optional condition/retry nodes repair invalid JSON or return an unsupported marker.
4. Locally wrap the layout into `DiagramPack` with qid/slug/match metadata.
5. Validate the JSON and linked-list semantics locally.
6. Render SVG fixtures for visual review.
7. Commit only reviewed packs under `resources/diagrams/`.

## Commands

```bash
COZE_API_TOKEN=... npm run diagram:author -- \
  --qid 203 \
  --slug remove-linked-list-elements \
  --image /tmp/removelinked-list.png \
  --image-src-includes removelinked-list \
  --workflow-id 1234567890 \
  --out resources/diagrams/203.remove-linked-list-elements.json

npm run diagram:validate
npm run diagram:render-fixtures
```

`diagram:author` is a convenience entrypoint for the first two AI nodes. Human
review remains required before a generated pack is accepted.

The script reads API defaults from the extension setting
`leetcode-problem-rating.diagramAuthor.api`, then `.vscode/settings.json` if it
exists, then an optional `--config` JSON file, then CLI flags. The user can fill
`token` and `workflowId` in VS Code settings or set `COZE_API_TOKEN` in the shell.

## Coze Workflow Contract

Recommended workflow input variable:

- `image`

Recommended workflow output variable name:

- `diagram`

For Coze node JSON sync, keep imported node variables shallow. Coze's JSON sync
rules include: key names are capped at 20 characters, `null` values are ignored,
and nesting deeper than 3 levels is truncated. Therefore, complex intermediate
objects should be passed as JSON strings.

Important: the workflow start node variable `image` should be configured as an
Image/file variable in Coze, not as a String variable. The local API caller passes
that Image value as a JSON-serialized file reference string only because Coze's
Workflow Run API requires file inputs in that transport format.

The recommended workflow output is a string field named `diagram`. The local
script parses that string, wraps it into a `DiagramPack`, then refuses to write
the file unless the result passes `validateDiagramPack`.

## Coze Node JSON Templates

Use these sample JSON blocks for Coze's "Sync JSON to node" action where it
matches the Coze UI. Put the descriptions into the variable description fields
manually when the Coze panel supports descriptions. For the start node, create
`image` manually as an Image/file variable if JSON sync infers it as String.

Start node API payload sample:

```json
{
  "image": "{\"file_id\":\"7440000000000000000\"}"
}
```

Start node variable descriptions:

- `image`: Image/file variable in Coze. The API caller supplies it as a
  JSON-serialized file reference string like `{"file_id":"..."}`, but workflow
  nodes should consume it as an image.

`visual_evidence` node output JSON:

```json
{
  "kind": "linked_list_transform",
  "evidence_json": "{\"kind\":\"linked_list_transform\",\"visibleTexts\":[\"Input\",\"Output\"],\"rows\":[{\"nodes\":[1,2,6,3,4,5,6],\"highlightIndexes\":[2,6]},{\"nodes\":[1,2,3,4,5],\"highlightIndexes\":[]}],\"uncertainties\":[]}"
}
```

`visual_evidence` output descriptions:

- `kind`: One of `linked_list_transform`, `unsupported`, or `uncertain`.
- `evidence_json`: JSON string containing visible evidence. Keep it as a string
  to avoid Coze JSON sync nesting limits.

`compile_diagram_layout` node output JSON:

```json
{
  "ok": true,
  "diagram": "{\"type\":\"linkedListTransform\",\"before\":{\"nodes\":[1,2,6,3,4,5,6],\"highlights\":[{\"index\":2,\"tone\":\"danger\"},{\"index\":6,\"tone\":\"danger\"}]},\"after\":{\"nodes\":[1,2,3,4,5]},\"transition\":{\"type\":\"downArrow\",\"fromIndex\":3,\"toIndex\":2}}",
  "issues": []
}
```

`compile_diagram_layout` output descriptions:

- `ok`: Whether the compiler believes the result follows the contract.
- `diagram`: Final diagram layout as a JSON string. This is the field read by
  the local script and wrapped into `DiagramPack`.
- `issues`: Human-readable warnings or repair notes.

`validate_or_repair` node output JSON:

```json
{
  "ok": true,
  "diagram": "{\"type\":\"linkedListTransform\",\"before\":{\"nodes\":[1,2,6,3,4,5,6],\"highlights\":[{\"index\":2,\"tone\":\"danger\"},{\"index\":6,\"tone\":\"danger\"}]},\"after\":{\"nodes\":[1,2,3,4,5]},\"transition\":{\"type\":\"downArrow\",\"fromIndex\":3,\"toIndex\":2}}",
  "issues": []
}
```

`validate_or_repair` output descriptions:

- `ok`: Whether the current `diagram` is syntactically valid JSON and
  structurally plausible.
- `diagram`: Repaired diagram layout JSON string.
- `issues`: Remaining validation warnings.

End node sample JSON:

```json
{
  "diagram": "{\"type\":\"linkedListTransform\",\"before\":{\"nodes\":[1,2,6,3,4,5,6],\"highlights\":[{\"index\":2,\"tone\":\"danger\"},{\"index\":6,\"tone\":\"danger\"}]},\"after\":{\"nodes\":[1,2,3,4,5]},\"transition\":{\"type\":\"downArrow\",\"fromIndex\":3,\"toIndex\":2}}"
}
```

## Current Scope

Version 1 supports only `linkedListTransform`. Add new diagram types by extending
the schema, validator, renderer, fixtures, and this authoring contract together.
