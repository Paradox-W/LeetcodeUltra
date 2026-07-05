import {
	DataExtractionResult,
	isVisualizationData,
} from "@hediet/debug-visualizer-data-extraction";
import { FormattedMessage } from "../webviewContract";

export interface ParseEvaluationResultContext {
	debugAdapterType: string;
}

export function parseEvaluationResultFromGenericDebugAdapter(
	resultText: string,
	context: ParseEvaluationResultContext
):
	| { kind: "data"; result: DataExtractionResult }
	| { kind: "error"; message: FormattedMessage } {
	const jsonData = resultText.trim();

	let resultObj;
	try {
		resultObj = parseVisualizationJson(jsonData, context);

		if (!isVisualizationData(resultObj)) {
			return {
				kind: "error",
				message: {
					kind: "list",
					items: [
						"Evaluation result does not match ExtractedData interface.",
						{
							kind: "inlineList",
							items: [
								"Evaluation result was:",
								{
									kind: "code",
									content: JSON.stringify(
										resultObj,
										undefined,
										4
									),
								},
							],
						},
					],
				},
			};
		}
	} catch (e: any) {
		return {
			kind: "error",
			message: e.message,
		};
	}

	return {
		kind: "data",
		result: {
			availableExtractors: [],
			usedExtractor: {
				id: "generic" as any,
				name: "Generic",
				priority: 1,
			},
			data: resultObj,
		},
	};
}

function parseJson(str: string, context: ParseEvaluationResultContext) {
	try {
		return JSON.parse(str);
	} catch (error: any) {
		throw new FormattedError({
			kind: "list",
			items: [
				"Could not parse evaluation result as JSON:",
				error.message,
				{
					kind: "inlineList",
					items: [
						"Evaluation result was:",
						{
							kind: "code",
							content: str,
						},
					],
				},
				`Used debug adapter: ${context.debugAdapterType}`,
			],
		});
	}
}

function parseVisualizationJson(
	jsonData: string,
	context: ParseEvaluationResultContext
): unknown {
	let lastError: unknown;
	for (const candidate of getCandidateStrings(jsonData)) {
		try {
			let result = parseJson(candidate, context);
			for (let i = 0; i < 3 && typeof result === "string"; i++) {
				const text = result.trim();
				if (!text.startsWith("{") && !text.startsWith("[")) {
					break;
				}
				result = parseJson(text, context);
			}
			return result;
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}

function getCandidateStrings(text: string): string[] {
	const result: string[] = [];
	const seen = new Set<string>();

	const add = (value: string | undefined) => {
		if (value === undefined) {
			return;
		}
		const trimmed = value.trim();
		if (trimmed && !seen.has(trimmed)) {
			seen.add(trimmed);
			result.push(trimmed);
		}
	};

	add(text);
	for (const quoted of getQuotedSubstrings(text)) {
		add(quoted);
		add(stripEnclosingQuotes(quoted));
	}

	for (let i = 0; i < result.length; i++) {
		const candidate = result[i];
		add(stripEnclosingQuotes(candidate));
		add(substringFromFirstJsonStart(candidate));

		const unescaped = candidate
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\");
		if (unescaped !== candidate) {
			add(unescaped);
			add(substringFromFirstJsonStart(unescaped));
		}
	}

	return result;
}

function stripEnclosingQuotes(text: string): string | undefined {
	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	) {
		return text.substr(1, text.length - 2);
	}
	return undefined;
}

function getQuotedSubstrings(text: string): string[] {
	const result: string[] = [];
	for (const quote of ['"', "'"]) {
		const start = text.indexOf(quote);
		const end = text.lastIndexOf(quote);
		if (start !== -1 && end > start) {
			result.push(text.substr(start, end - start + 1));
		}
	}
	return result;
}

function substringFromFirstJsonStart(text: string): string | undefined {
	const objectStart = text.indexOf("{");
	const arrayStart = text.indexOf("[");
	const starts = [objectStart, arrayStart].filter(i => i !== -1);
	if (starts.length === 0) {
		return undefined;
	}
	const start = Math.min(...starts);
	return text.substr(start);
}

class FormattedError {
	constructor(public readonly message: FormattedMessage) {}
}
