# Diagram Authoring Contract

LeetcodeUltra renders problem diagrams from reviewed JSON, not from AI-generated
JavaScript, HTML, CSS, SVG, or LaTeX.

The offline authoring script defaults to a Coze / 扣子 workflow:

- API token source: `leetcode-problem-rating.diagramAuthor.api.token` or
  `COZE_API_TOKEN`
- Workflow id source: `leetcode-problem-rating.diagramAuthor.api.workflowId` or
  `--workflow-id`
- Model choice lives inside Coze workflow nodes, not inside this repository.
- Recommended workflow shape: image evidence node, diagram-layout compiler node,
  schema repair branch, final `diagram` output.

## Runtime Contract

The extension runtime reads `resources/diagrams/<qid>.<slug>.json` and replaces a
matched problem `<img>` with a native, theme-aware SVG. If a pack is missing,
invalid, unsupported, or unmatched, the original image remains visible.

## Coze Output Contract

The Coze workflow should output only the diagram layout. The local script wraps
this layout with qid, slug, title, and image matching metadata.

```json
{
  "type": "linkedListTransform",
  "before": {
    "nodes": [1, 2, 6, 3, 4, 5, 6],
    "highlights": [
      { "index": 2, "tone": "danger" },
      { "index": 6, "tone": "danger" }
    ]
  },
  "after": {
    "nodes": [1, 2, 3, 4, 5]
  },
  "transition": {
    "type": "downArrow",
    "fromIndex": 3,
    "toIndex": 2
  }
}
```

## Pack Contract

LeetcodeUltra stores reviewed `DiagramPack` JSON. The first supported diagram
type is `linkedListTransform`.

```json
{
  "version": 1,
  "problem": {
    "qid": "203",
    "slug": "remove-linked-list-elements",
    "title": "Remove Linked List Elements"
  },
  "replacements": [
    {
      "match": {
        "imageSrcIncludes": "removelinked-list",
        "example": 1
      },
      "diagram": {
        "type": "linkedListTransform",
        "before": {
          "nodes": [1, 2, 6, 3, 4, 5, 6],
          "highlights": [
            { "index": 2, "tone": "danger" },
            { "index": 6, "tone": "danger" }
          ]
        },
        "after": {
          "nodes": [1, 2, 3, 4, 5]
        },
        "transition": {
          "type": "downArrow",
          "fromIndex": 3,
          "toIndex": 2
        }
      }
    }
  ]
}
```

## Rules For Agents

- Use only values visible in the image.
- Do not infer hidden nodes or operations.
- Leave `replacements` empty if the image is ambiguous or unsupported.
- Use zero-based indexes for node highlights.
- Use `danger` for removed or invalid nodes, `accent` for important pointers, and
  `muted` for secondary emphasis.
- Run `npm run diagram:validate` before submitting a pack.
- Run `npm run diagram:render-fixtures` and inspect `out/diagram-fixtures/index.html`
  before accepting the rendered result.
