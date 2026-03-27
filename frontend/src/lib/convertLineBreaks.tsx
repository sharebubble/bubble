import { createElement, ReactNode } from 'react';

/**
 * Converts line breaks in plain text input to React <br> elements.
 *
 * Example:
 * Input: "foo\nbar"
 * Output: ["foo", <br>, "bar"]
 * Renders in JSX as: foo<br>bar
 *
 * @param text - The text string containing line breaks (LF, CRLF, or CR)
 * @returns An array of React nodes with text and <br> elements
 */
export function convertLineBreaks(text: string): ReactNode[] {
  const lines = text.split(/\r\n|\r|\n/);
  const nodes: ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    nodes.push(createElement('span', { key: `line-${i}` }, lines[i]));
    if (i < lines.length - 1) {
      nodes.push(createElement('br', { key: `br-${i}` }));
    }
  }

  return nodes;
}
