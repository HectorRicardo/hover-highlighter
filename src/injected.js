'use strict';

/**
 * @fileoverview
 *
 * Highlights the word and line under the cursor as follows:
 *
 * 1. We listen to the pointermove event.
 * 2. Using the `document.caretPositionFromPoint()` function, we identify the
 *    word under the cursor and put it inside a Range. We use the `isDelimiter`
 *    function as the definition of word delimiters.
 * 3. We also identify the Range that covers the visual line in which the word
 *    lies. For this identification, we expand the range character by character
 *    from both its ends, and we stop as soon as the Range spans more than one
 *    line. We use a heuristic to identify when the range begins spanning more
 *    than one line; please see `highlightLineRangeSpansMultipleLines()`.
 * 3. Finally, we highlight both Ranges using the CSS Highlight API.
 */

(() => {
  // All this code is executed when the extension is toggled, i.e., when its
  // action button in the Chrome toolbar is clicked.

  const CSS_HIGHLIGHT_WORD_KEY = 'hover-highlighter_word';
  const CSS_HIGHLIGHT_LINE_KEY = 'hover-highlighter_line';
  const HOVER_HIGHLIGHTER_INFO_WINDOW_KEY = 'hoverHighlighterInfo';

  // Check if the extension is being turned on or off.

  if (window[HOVER_HIGHLIGHTER_INFO_WINDOW_KEY] != null) {
    console.log('Turning off Hover Highlighter.');

    const {pointerMoveHandler, pointerLeaveHandler} =
        window[HOVER_HIGHLIGHTER_INFO_WINDOW_KEY];

    document.body.removeEventListener('pointermove', pointerMoveHandler);
    document.body.removeEventListener('pointerleave', pointerLeaveHandler);

    pointerLeaveHandler();

    delete window[HOVER_HIGHLIGHTER_INFO_WINDOW_KEY];
    CSS.highlights.delete(CSS_HIGHLIGHT_WORD_KEY);
    CSS.highlights.delete(CSS_HIGHLIGHT_LINE_KEY);

    return false;
  }

  console.log('Turning on Hover Highlighter.');

  /**
   * Returns true if the given character is a delimiter. The following chars are
   * considered delimiters:
   *
   * - whitespace
   * - underscore _
   * - hyphens - and –
   * - slash /
   * - open and close parentheses ()
   * - open and close square brackets []
   * - open and close curly braces {}
   * - comma ,
   * - dot .
   * - colon :
   * - semicolon ;
   * - question mark ?
   * - exclamation mark !
   * - ellipsis …
   *
   * @param {string} char A string of length 1.
   * @return {boolean}
   */
  function isDelimiter(char) {
    return /[\s_\-–/\(\)\{\}\[\],\.:;?!…]/.test(char);
  }

  function isWordChar(char) {
    return !isDelimiter(char);
  }

  /**
   * @param {string} ch A string of length 1.
   * @return {boolean}
   */
  function isWhitespaceOrZeroWidth(ch) {
    return /\s|\p{Cf}/u.test(ch);
  }

  function rectanglesAreEqual(rect1, rect2) {
    return rect1.left === rect2.left && rect1.right === rect2.right &&
        rect1.top === rect2.top && rect1.bottom === rect2.bottom;
  }

  function isInsideRect(rect, x, y) {
    return rect.left <= x && x <= rect.right && rect.top <= y &&
        y <= rect.bottom && rect.width > 0 && rect.height > 0;
  }

  /** The range that contains the word currently highlighted. */
  const highlightWordRange = document.createRange();

  /**
   * Returns whether the given point lies outside the highlighted word. If
   * there is no highlighted word, then returns true.
   *
   * @param {number} x
   * @param {number} y
   * @return {boolean}
   */
  function isPointOutsideHighlightedWord(x, y) {
    if (highlightWordRange.collapsed) return true;

    // A word can be hyphenated across multiple lines, so we must check all
    // rectangles.
    for (const clientRect of highlightWordRange.getClientRects()) {
      if (isInsideRect(clientRect, x, y)) return false;
    }
    return true;
  }

  /**
   * Sets `highlightWordRange` to the word at the caret position. The word may
   * span multiple consecutive/sibling text nodes (all from the same parent).
   *
   * @param {?CaretPosition} caretPosition
   */
  function setHighlightWordRange(caretPosition) {
    if (caretPosition?.offsetNode.nodeType !== Node.TEXT_NODE) return;

    // Presupposition: the text node will never be empty, and offset >= 0.

    let endOffset;
    if (caretPosition.offset >= caretPosition.offsetNode.textContent.length) {
      // This condition is true in at least two situations:
      // 1. A paragraph's last word ends in the middle of the screen, but
      //    because the paragraph is a block element, the paragraph element
      //    actually extends to the end of the screen, and the mouse is hovering
      //    over the empty space after the paragraph ended.
      // 2. There is an empty text node in between letters of a word, and the
      //    mouse hovers in one of such letters.
      endOffset = caretPosition.offsetNode.textContent.length;
    } else if (isDelimiter(caretPosition.offsetNode
                               .textContent[caretPosition.offset])) {
      return;
    } else {
      endOffset = caretPosition.offset + 1;
    }

    // First, we'll find the exclusive position of the word. This logic will
    // find the farthest exclusive node, even if that is an empty text node.
    let endNode = caretPosition.offsetNode;
    while (true) {
      // Loop through the end of the current text node.
      while (endOffset < endNode.textContent.length &&
             isWordChar(endNode.textContent[endOffset])) {
        endOffset++;
      }

      // If we didn't finish looping the text node, that's because we bumped
      // into a delimiter, so we have found the word's end position. OTOH, if we
      // did finish looping the text node but the following node is not a text
      // node, then there's nothing more to search, so we have also found the
      // word's end position.
      if (endOffset < endNode.textContent.length ||
          endNode.nextSibling?.nodeType !== Node.TEXT_NODE) {
        break;
      }

      // The next node is a text node. We'll continue the search over there.
      endNode = endNode.nextSibling;
      endOffset = 0;
    }

    // Now, we'll find the inclusive position of the word.
    let startNode = caretPosition.offsetNode;
    let startOffset = caretPosition.offset;
    while (true) {
      // Loop through the beginning of the current text node.
      while (startOffset > 0 &&
             isWordChar(startNode.textContent[startOffset - 1])) {
        startOffset--;
      }

      // Check if we arrived to the beginning of the text node in the prior
      // loop. If we didn't, then it means that there was a delimiter, thus, we
      // have already found the start of the word.
      if (startOffset > 0) break;

      // Skip all the previous empty sibling text nodes.
      let prevNode = startNode;
      do {
        prevNode = prevNode.previousSibling;
      } while (prevNode?.nodeType === Node.TEXT_NODE &&
               prevNode.textContent === '');

      // If there are no more previous siblings, or we bumped into a non-text
      // node sibling, or we bumped into a text node sibling but its last char
      // was a delimiter, then there's nothing more to search.
      if (prevNode?.nodeType !== Node.TEXT_NODE ||
          isDelimiter(prevNode.textContent[prevNode.textContent.length - 1])) {
        break;
      }

      // Move to that previous non-empty sibling text node to look for the start
      // of the word in there.
      startOffset = prevNode.textContent.length - 1;
      startNode = prevNode;
    }

    highlightWordRange.setStart(startNode, startOffset);
    highlightWordRange.setEnd(endNode, endOffset);
  }

  class CachedLineRange extends Range {
    #boundingClientRect = null;

    /**
     * The number of expansions to the `highlightLineRange` so far. Should be
     * reset to 0 in between triggers of the `pointermove` event.
     */
    #linesSpannedChecks = 0;

    /**
     * A limit on the number of expansions to the `highlightLineRange` to check
     * if including the previous or next character in the `highlightLineRange`
     * causes it to overflow to a new line.
     *
     * We need to limit the number of expansion checks because all this logic runs
     * in the `pointermove` event, and it shouldn't take long (otherwise, we get
     * laggy UI experience).
     */
    static MAX_LINES_SPANNED_CHECKS = 115;

    collapse() {
      this.invalidateBoundingClientRectangle();
      super.collapse();
    }

    getBoundingClientRect() {
      return this.#boundingClientRect ??= super.getBoundingClientRect();
    }

    invalidateBoundingClientRectangle() {
      this.#boundingClientRect = null;
    }

    resetLinesSpannedChecksCount() {
      this.#linesSpannedChecks = 0;
    }

    setEnd(node, offset) {
      this.invalidateBoundingClientRectangle();
      super.setEnd(node, offset);
    }

    setStart(node, offset) {
      this.invalidateBoundingClientRectangle();
      super.setStart(node, offset);
    }

    /**
     * Returns whether `highlightLineRange` spans multiple lines.
     *
     * We use a heuristic to identify whether the range spans multiple lines.
     * Let "f" be some hand-tuned factor between (1, 2]. For a range to span a
     * single line, its bounding rectangle's height needs to be strictly less
     * than "f" times the height of the range's shortest constituent rectangle.
     *
     * @return {boolean}
     */
    spansMultipleLines() {
      if (++this.#linesSpannedChecks > CachedLineRange.MAX_LINES_SPANNED_CHECKS) {
        return true;
      }

      const rects = Array.from(this.getClientRects())
                        .filter(({width, height}) => width > 0 && height > 0);
      if (rects.length < 2) return false;

      const minHeight = Math.min(...rects.map(({height}) => height));

      // If f=2, then we highlight two lines in https://ground.news
      const f = 1.73;

      return f * minHeight <= this.getBoundingClientRect().height;
    }

    /**
     * Expands `highlightLineRange` to the given new end node and offset, and
     * then checks if the range spans more than one line. If it does, we
     * rollback the expansion and return false. Otherwise, we return true.
     *
     * If `checkRectangleGrew` is true, then we also do an additional check: if
     * the range's bounding rectangle isn't strictly bigger after the expansion,
     * then we return false (and also rollback the expansion).
     *
     * This function is symmetrical to `expandHighlightLineRangeStartSafely()`.
     *
     * @param {!Node} newNode Should be a text node.
     * @param {number} newOffset Should lie in (0, textContent.length].
     * @param {boolean} checkRectangleGrew
     * @return {boolean}
     */
    tryToExpandEnd(newNode, newOffset, checkRectangleGrew) {
      const prevNode = this.endContainer;
      const prevOffset = this.endOffset;
      const prevRect = checkRectangleGrew ? this.getBoundingClientRect() : null;

      this.setEnd(newNode, newOffset);

      if (checkRectangleGrew &&
              rectanglesAreEqual(prevRect, this.getBoundingClientRect()) ||
          highlightLineRange.spansMultipleLines()) {
        // Rollback the range to its previous position, since expanding to the
        // new position either did nothing or caused the range to span multiple
        // lines.
        this.setEnd(prevNode, prevOffset);
        return false;
      }
      return true;
    }

    /**
     * Expands `highlightLineRange` to the given new start node and offset, and
     * then checks if the range spans more than one line. If it does, we rollback
     * the expansion and return false. Otherwise, we return true.
     *
     * If `checkRectangleGrew` is true, then we also do an additional check: if
     * the range's bounding rectangle isn't strictly bigger after the expansion,
     * then we return false (and also rollback the expansion).
     *
     * This function is symmetrical to `expandHighlightLineRangeEndSafely()`.
     *
     * @param {!Node} newNode Should be a text node.
     * @param {number} newOffset Should lie in [0, textContent.length).
     * @param {boolean} checkRectangleGrew
     * @return {boolean}
     */
    tryToExpandStart(newNode, newOffset, checkRectangleGrew) {
      const prevNode = this.startContainer;
      const prevOffset = this.startOffset;
      const prevRect = checkRectangleGrew ? this.getBoundingClientRect() : null;

      this.setStart(newNode, newOffset);

      if (checkRectangleGrew &&
              rectanglesAreEqual(prevRect, this.getBoundingClientRect()) ||
          highlightLineRange.spansMultipleLines()) {
        // Rollback the range to its previous position, since expanding to the
        // new position either did nothing or caused the range to span multiple
        // lines.
        this.setStart(prevNode, prevOffset);
        return false;
      }
      return true;
    }
  }

  /** The range that contains the line currently highlighted. */
  const highlightLineRange = new CachedLineRange();

  function isPointOutsideHighlightedLine(x, y) {
    return highlightLineRange.collapsed ||
        !isInsideRect(highlightLineRange.getBoundingClientRect(), x, y);
  }

  /**
   * Sets `highlightLineRange` to the line at the caret position. The line may
   * span multiple nodes from different parents.
   *
   * @param {?CaretPosition} caretPosition The position of the caret.
   * @param {number} mouseY The y coordinate of the cursor.
   */
  function setHighlightLineRange(caretPosition, mouseY) {
    if (caretPosition?.offsetNode.nodeType !== Node.TEXT_NODE) return;

    // See the big comment inside `setHighlightWordRange` to understand in which
    // situations can offset >= length.
    const startOffset = Math.min(
        caretPosition.offset, caretPosition.offsetNode.textContent.length - 1);

    highlightLineRange.setStart(caretPosition.offsetNode, startOffset);
    highlightLineRange.setEnd(caretPosition.offsetNode, startOffset + 1);

    // Optimization: if right from the get-go we see that we're outside the
    // y-axis of the line rectangle, then don't highlight the line. Notes:
    // - The same check for the x-axis is not very precise, hence we skip it.
    // - We don't do this for the word, because words are usually short enough
    //   that the optimization is not worth it.
    const lineRect = highlightLineRange.getBoundingClientRect();
    if (lineRect.height === 0 || mouseY < lineRect.top ||
        lineRect.bottom < mouseY) {
      highlightLineRange.collapse(false);
      return;
    }

    // In theory, a range spanning only character should lie in one line.
    // However, if the character is the one that comes after the hyphen in a
    // hyphenated word, the browser believes it spans 2 lines. So we defend
    // ourselves against that case.
    // TODO - check if this behavior is a bug or is intended.
    if (highlightLineRange.getClientRects().length > 1) {
      highlightLineRange.collapse(false);
      return;
    }

    highlightLineRange.resetLinesSpannedChecksCount();

    let keepGoingStart = true;
    let keepGoingEnd = true;

    do {
      keepGoingEnd = updateHighlightLineRangeEnd(/* oneChar= */ true);
      keepGoingStart = updateHighlightLineRangeStart(/* oneChar= */ true);
    } while (keepGoingStart && keepGoingEnd);

    if (keepGoingStart) {
      updateHighlightLineRangeStart(/* oneChar= */ false);
    }

    if (keepGoingEnd) {
      updateHighlightLineRangeEnd(/* oneChar= */ false);
    }

    // This if-check means: if the caret is pointing to the leading or trailing
    // whitespace of the line, then this doesn't count as valid highlighting.
    if (highlightLineRange.startContainer === caretPosition.offsetNode &&
            highlightLineRange.startOffset === startOffset &&
            isWhitespaceOrZeroWidth(
                highlightLineRange.startContainer.textContent[startOffset]) ||
        highlightLineRange.endContainer === caretPosition.offsetNode &&
            highlightLineRange.endOffset === startOffset + 1 &&
            isWhitespaceOrZeroWidth(
                highlightLineRange.endContainer.textContent[startOffset])) {
      highlightLineRange.collapse(false);
    }
  }

  /**
   * Expands `highlightLineRange`'s start position without causing it to span
   * more than one line. If `oneChar` is true, then the range is only expanded
   * at most one character. Otherwise, it is expanded as much as possible.
   *
   * If `oneChar` is true, then returns whether the range's start position was
   * expanded one char. Otherwise, returns false.
   *
   * Precondition: `highlightLineRange` must be non-empty and span one line.
   *
   * This function is symmetrical to `updateHighlightLineRangeEnd()`.
   *
   * @param {boolean} oneChar
   * @return {boolean}
   */
  function updateHighlightLineRangeStart(oneChar) {
    let currentNode = highlightLineRange.startContainer;
    let currentOffset = highlightLineRange.startOffset;

    while (true) {
      // Loop through the beginning of the current node.
      while (currentOffset > 0) {
        if (isWhitespaceOrZeroWidth(currentNode.textContent[--currentOffset])) {
          continue;
        }

        // Check if we can expand the start position to include the previous
        // character. If not, we return.
        if (!highlightLineRange.tryToExpandStart(
                currentNode, currentOffset, /* checkRectangleGrew = */ false)) {
          return false;
        }

        if (oneChar) return true;
      }

      // We managed to expand the start of `highlightRange` to include the
      // current text node without causing `highlightRange` to span more than
      // one line. We must now look for the previous node in the DOM tree.
      // Note that the previous node does not necessarily mean previous sibling,
      // which is why this algorithm is a bit complex.

      while (true) {
        let previousNode = currentNode.previousSibling;
        if (previousNode == null || !occupiesSpace(previousNode)) {
          // Complex scenario: there is no previous consecutive sibling. We must
          // go to the previous uncle.
          let parent = currentNode.parentNode;
          while (true) {
            if (parent === document.body) {
              // We arrived at the very beginning of the HTML page. Nothing else
              // to do.
              return false;
            }
            if (parent.previousSibling != null && occupiesSpace(parent.previousSibling)) {
              previousNode = parent.previousSibling;
              break;
            }
            // We don't have a previous uncle. Move to the grandparent and keep
            // looking there.
            parent = parent.parentNode;
          }
        }

        // We found the previous node in the DOM tree. We must look for its last
        // child text. Note that, in this context, a node is considered a child
        // of itself.
        const lastTextNode = getLastNonEmptyTextNode(previousNode);
        if (lastTextNode == null) {
          // No text nodes covered by `previousNode`. Move on to the previous
          // node to restart the search for the new previous node.
          currentNode = previousNode;
          continue;
        }

        const lastCharIdx = lastTextNode.textContent.length - 1;
        const shouldSkip =
            isWhitespaceOrZeroWidth(lastTextNode.textContent[lastCharIdx]);

        if (shouldSkip ||
            highlightLineRange.tryToExpandStart(
                lastTextNode, lastCharIdx, /* checkRectangleGrew= */ true)) {
          // We don't have evidence that including this position will cause the
          // line to overflow. Break out of this inner loop to begin executing
          // this whole function again.

          currentNode = lastTextNode;
          currentOffset = lastTextNode.textContent.length - 1;
          if (oneChar && !shouldSkip) return true;
          break;
        }
        // Expanding to the last text node will inevitably cause the range to
        // span more than one line. Exiting now.
        return false;
      }
    }
  }

  function occupiesSpace(node) {
    return node.nodeType !== Node.ELEMENT_NODE || (node.offsetWidth > 0 && node.offsetHeight > 0);
  }

  /**
   * Expands `highlightLineRange`'s end position as much as possible without
   * causing it to span more than one line.
   *
   * If `oneChar` is true, then returns whether the range's end position was
   * expanded one char. Otherwise, returns false.
   *
   * Precondition: `highlightLineRange` must be non-empty and span one line.
   *
   * This function is symmetrical to `updateHighlightLineRangeStart()`.
   */
  function updateHighlightLineRangeEnd(oneChar) {
    let currentNode = highlightLineRange.endContainer;
    let currentOffset = highlightLineRange.endOffset;
    let checkRectangleGrew = false;

    while (true) {
      // Loop through the end of the current node.
      while (currentOffset < currentNode.textContent.length) {
        if (isWhitespaceOrZeroWidth(currentNode.textContent[currentOffset++])) {
          continue;
        }

        // Check if we can expand the end position to include the next
        // character. If not, we return.
        if (!highlightLineRange.tryToExpandEnd(
                currentNode, currentOffset, checkRectangleGrew)) {
          return false;
        }

        // We can expand the range, keep going.
        if (oneChar) return true;
        checkRectangleGrew = false;
      }

      // We managed to expand the end of `highlightRange` to include the
      // current text node without causing `highlightRange` to span more than
      // one line. We must now look for the next node in the DOM tree. Note that
      // the next node does not necessarily mean next sibling, which is why this
      // algorithm is a bit complex.

      while (true) {
        let nextNode = currentNode.nextSibling;
        if (nextNode == null || !occupiesSpace(nextNode)) {
          // Complex scenario: there is no next consecutive sibling. We must go
          // to the next uncle.
          let parent = currentNode.parentNode;
          while (true) {
            if (parent === document.body) {
              // We arrived at the very beginning of the HTML page. Nothing else
              // to do.
              return false;
            }
            if (parent.nextSibling != null && occupiesSpace(parent.nextSibling)) {
              nextNode = parent.nextSibling;
              break;
            }
            // We don't have a next uncle. Move to the grandparent and keep
            // looking there.
            parent = parent.parentNode;
          }
        }

        // We found the next node in the DOM tree. We must look for its first
        // child text. Note that, in this context, a node is considered a child
        // of itself.
        const nextTextNode = getNextTextNode(nextNode);
        if (nextTextNode == null) {
          // No text nodes covered by `nextNode`. Move on to the next node to
          // restart the search for the new next node.
          currentNode = nextNode;
          continue;
        }
        // We don't have evidence that including this position will cause the
        // line to overflow. Break out of this inner loop to begin executing
        // this whole function again.
        currentNode = nextTextNode;
        currentOffset = 0;
        checkRectangleGrew = true;
        break;
      }
    }
  }

  function getLastNonEmptyTextNode(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      return root.textContent === '' ? null : root;
    }
    for (let i = root.childNodes.length - 1; i >= 0; i--) {
      const childNode = root.childNodes[i];
      if (!occupiesSpace(childNode)) continue;
      const lastTextNode = getLastNonEmptyTextNode(childNode);
      if (lastTextNode != null) return lastTextNode;
    }
    return null;
  }

  function getNextTextNode(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      return root.textContent === '' ? null : root;
    }
    for (const childNode of root.childNodes) {
      if (!occupiesSpace(childNode)) continue;
      const nextTextNode = getNextTextNode(childNode);
      if (nextTextNode != null) return nextTextNode;
    }
    return null;
  }

  /**
   * The pointer move callback handler. This is the starting point of our
   * highlighting logic.
   */
  const pointerMoveHandler = (event) => {
    let caretPosition = undefined;

    if (isPointOutsideHighlightedWord(event.x, event.y)) {
      // Unhighlight the previous word.
      highlightWordRange.collapse(false);

      // Find out the word under the caret/cursor and highlight it.
      caretPosition = document.caretPositionFromPoint(event.x, event.y);
      setHighlightWordRange(caretPosition);

      if (isPointOutsideHighlightedWord(event.x, event.y)) {
        // This means that either there is no word under the cursor, or the word
        // under the caret is not truly under the cursor. This latter
        // discrepancy arises in at least two situations:
        // 1. The cursor is above a paragraph, but the caret is calculated to
        //    be at the start of such paragraph.
        // 2. The cursor is after the last word of a paragraph, but because a
        //    paragraph is a block element (and thus, its width extends to the
        //    parent's width), the caret is calculated to be on such last
        //    word.
        // In those cases, we undo the highlighting of the word.
        highlightWordRange.collapse(false);
      }
    }

    highlightLineRange.invalidateBoundingClientRectangle();

    if (isPointOutsideHighlightedLine(event.x, event.y)) {
      // Note: how can the cursor be outside the highlighted word, but inside
      // the highlighted line? Answer: this can theoretically happen when the
      // highlighted word is hyphenated, and the mouse instantly moves from
      // the first part of the word to the second part of the word.

      // Unhighlight the previous line.
      highlightLineRange.collapse(false);

      // Reuse the caret position from the word highlighting logic, or retrieve
      // it if that logic was skipped.
      if (caretPosition === undefined) {
        caretPosition = document.caretPositionFromPoint(event.x, event.y);
      }

      if (event.ctrlKey) debugger;

      // Find out the line under the caret/cursor and highlight it.
      setHighlightLineRange(caretPosition, event.y);

      if (isPointOutsideHighlightedLine(event.x, event.y)) {
        // Either there was no line highlighted, or the line under the caret is
        // not truly under the cursor. See similar comment above for an
        // explanation on when this can happen.
        highlightLineRange.collapse(false);
      }
    }
  };

  const pointerLeaveHandler = () => {
    highlightWordRange.collapse(false);
    highlightLineRange.collapse(false);
  };

  // Entry points and side effects below.

  // Register the word and line ranges in the CSS Highlights API. First the
  // line range, then the word range, so that the word highlighting overrides
  // the line highlighting.
  CSS.highlights
      .set(CSS_HIGHLIGHT_LINE_KEY, new Highlight().add(highlightLineRange))
      .set(CSS_HIGHLIGHT_WORD_KEY, new Highlight().add(highlightWordRange));

  document.body.addEventListener('pointermove', pointerMoveHandler);
  document.body.addEventListener('pointerleave', pointerLeaveHandler);

  // Set all the colors according to the arguments.
  const {hoverHighlighterArgs} = window;

  document.documentElement.style.setProperty(
      '--hover_highlighter-line_background_color',
      hoverHighlighterArgs.lineBackgroundColor,
  );
  document.documentElement.style.setProperty(
      '--hover_highlighter-line_text_color',
      hoverHighlighterArgs.lineTextColor,
  );
  document.documentElement.style.setProperty(
      '--hover_highlighter-word_background_color',
      hoverHighlighterArgs.wordBackgroundColor,
  );
  document.documentElement.style.setProperty(
      '--hover_highlighter-word_text_color',
      hoverHighlighterArgs.wordTextColor,
  );

  // This value is useful in two ways:
  // 1. The presence/absence of this value is used as a state to know whether
  //    the extension should be turned on/off.
  // 2. When the extension will be turned off, we need a reference to the
  //    listener callbacks so we can remove them.
  window[HOVER_HIGHLIGHTER_INFO_WINDOW_KEY] = {
    pointerMoveHandler,
    pointerLeaveHandler,
  };
  return true;
})();
