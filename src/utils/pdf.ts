import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

function shouldRetryWithoutWorker(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /worker|importScripts|fake worker|module script/i.test(message);
}

async function extractText(
  buffer: ArrayBuffer,
  disableWorker: boolean,
): Promise<string> {
  const options: Parameters<typeof getDocument>[0] = {
    data: new Uint8Array(buffer),
  };

  if (disableWorker) {
    (options as Record<string, unknown>).disableWorker = true;
  }

  const loadingTask = getDocument(options);
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const texts = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean);
    pages.push(texts.join(' '));
  }

  return pages.join('\n\n');
}

export async function extractTextFromPdf(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try {
    return await extractText(buffer, false);
  } catch (error) {
    if (shouldRetryWithoutWorker(error)) {
      return extractText(buffer, true);
    }
    throw error;
  }
}
