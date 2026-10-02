onUiLoaded(async() => {
    // Helper functions

    // Detect whether the element has a horizontal scroll bar
    function hasHorizontalScrollbar(element) {
        return element.scrollWidth > element.clientWidth;
    }

    // Function for defining the "Ctrl", "Shift" and "Alt" keys
    function isModifierKey(event, key) {
        switch (key) {
        case "Ctrl":
            return event.ctrlKey;
        case "Shift":
            return event.shiftKey;
        case "Alt":
            return event.altKey;
        default:
            return false;
        }
    }

    // Create hotkey configuration with the provided options
    function createHotkeyConfig(defaultHotkeysConfig) {
        const result = {}; // Resulting hotkey configuration
        for (const key in defaultHotkeysConfig) {
            result[key] = defaultHotkeysConfig[key];
        }
        return result;
    }

    // Default config
    const defaultHotkeysConfig = {
        canvas_hotkey_zoom: "Shift",
        canvas_hotkey_adjust: "Ctrl",
        canvas_zoom_undo_extra_key: "Ctrl",
        canvas_zoom_hotkey_undo: "KeyZ",
        canvas_hotkey_reset: "KeyR",
        canvas_hotkey_fullscreen: "KeyS",
        canvas_hotkey_move: "KeyF",
        canvas_show_tooltip: true,
        canvas_auto_expand: true,
        canvas_blur_prompt: true,
    };

    // Loading the configuration from opts
    const hotkeysConfig = createHotkeyConfig(
        defaultHotkeysConfig
    );

    let isMoving = false;
    let activeElement;

    const elemData = {};

    function applyZoomAndPan(elemId) {
        const targetElement = gradioApp().querySelector(elemId);

        if (!targetElement) {
            console.log("Element not found");
            return;
        }

        targetElement.style.transformOrigin = "0 0";

        elemData[elemId] = {
            zoomLevel: 1,
            panX: 0,
            panY: 0
        };

        let fullScreenMode = false;

        // Create tooltip
        function createTooltip() {
            const toolTipElemnt =
                targetElement.querySelector(".image-container");
            const tooltip = document.createElement("div");
            tooltip.className = "canvas-tooltip";

            // Creating an item of information
            const info = document.createElement("i");
            info.className = "canvas-tooltip-info";
            info.textContent = "";

            // Create a container for the contents of the tooltip
            const tooltipContent = document.createElement("div");
            tooltipContent.className = "canvas-tooltip-content";

            // Define an array with hotkey information and their actions
            const hotkeysInfo = [
                {
                    configKey: "canvas_hotkey_zoom",
                    action: "Zoom canvas",
                    keySuffix: " + wheel"
                },
                {
                    configKey: "canvas_hotkey_adjust",
                    action: "Adjust brush size",
                    keySuffix: " + wheel"
                },
                {configKey: "canvas_zoom_hotkey_undo", action: "Undo last action", keyPrefix: `${hotkeysConfig.canvas_zoom_undo_extra_key} + ` },
                {configKey: "canvas_hotkey_reset", action: "Reset zoom"},
                {
                    configKey: "canvas_hotkey_fullscreen",
                    action: "Fullscreen mode"
                },
                {configKey: "canvas_hotkey_move", action: "Move canvas"}
            ];

            // Create hotkeys array based on the config values
            const hotkeys = hotkeysInfo.map((info) => {
                const configValue = hotkeysConfig[info.configKey];
        
                let key = configValue.slice(-1);
        
                if (info.keySuffix) {
                  key = `${configValue}${info.keySuffix}`;
                }
        
                if (info.keyPrefix && info.keyPrefix !== "None + ") {
                  key = `${info.keyPrefix}${configValue[3]}`;
                }
        
                return {
                  key,
                  action: info.action,
                };
              });
        
              hotkeys
                .forEach(hotkey => {
                  const p = document.createElement("p");
                  p.innerHTML = `<b>${hotkey.key}</b> - ${hotkey.action}`;
                  tooltipContent.appendChild(p);
                });
        
              tooltip.append(info, tooltipContent);

              // Add a hint element to the target element
              toolTipElemnt.appendChild(tooltip);
        }

        //Show tool tip if setting enable
        if (hotkeysConfig.canvas_show_tooltip) {
            createTooltip();
        }

        // Visible toolbar with the most-used mask-painting actions, so the
        // zoom / fullscreen / brush controls are clickable instead of
        // hotkey-only. Re-created if Gradio re-renders the container.
        function createToolbar() {
            const container = targetElement.querySelector(".image-container");
            if (!container || container.querySelector(":scope > .mask-toolbar")) {
                return;
            }

            function zoomAtCenter(operation) {
                const rect = targetElement.getBoundingClientRect();
                doZoom(operation, rect.left + rect.width / 2, rect.top + rect.height / 2);
            }

            function clickNative(ariaLabel) {
                const btn = targetElement.querySelector(`button[aria-label="${ariaLabel}"]`);
                if (btn) btn.click();
            }

            const buttons = [
                { label: "+", title: "Zoom in (Shift + wheel)", onClick: () => zoomAtCenter("+") },
                { label: "\u2212", title: "Zoom out (Shift + wheel)", onClick: () => zoomAtCenter("-") },
                { label: "\u26F6", title: "Fullscreen (S)", onClick: () => fitToScreen() },
                { label: "\u27F2", title: "Reset view (R)", onClick: () => resetZoom() },
                { label: "B+", title: "Bigger brush (Ctrl + wheel)", onClick: () => adjustBrushSize(elemId, -120) },
                { label: "B\u2212", title: "Smaller brush (Ctrl + wheel)", onClick: () => adjustBrushSize(elemId, 120) },
                { label: "\u21A9", title: "Undo last stroke (Ctrl + Z)", onClick: () => clickNative("Undo") },
                { label: "\u232B", title: "Clear mask", onClick: () => clickNative("Clear") },
            ];

            const toolbar = document.createElement("div");
            toolbar.className = "mask-toolbar";

            // Second pen: eraser that deselects painted mask area while
            // drawing. Gradio 3.41.2's sketch tool is additive-only and hides
            // its color picker in mask mode, so the eraser is implemented in
            // ensureMaskFx() at the canvas composite level; these buttons just
            // switch that mode. Kept first in the toolbar: the most-used pair.
            function makeModeButton(glyph, title, ariaLabel) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "mask-toolbar-btn mask-toolbar-mode";
                btn.textContent = glyph;
                btn.title = title;
                btn.setAttribute("aria-label", ariaLabel);
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    const fx = ensureMaskFx();
                    if (fx) fx.setMode(ariaLabel === "Fooocus eraser pen" ? "eraser" : "pen");
                    syncFxButtons();
                });
                return btn;
            }

            const penBtn = makeModeButton("\u270F\uFE0F", "Pen: paint the mask", "Fooocus paint pen");
            const eraserBtn = makeModeButton("\uD83E\uDDFD", "Eraser: deselect painted mask area", "Fooocus eraser pen");
            targetElement._maskFxBtnRefs = { penBtn, eraserBtn };

            toolbar.appendChild(penBtn);
            toolbar.appendChild(eraserBtn);

            const sep = document.createElement("div");
            sep.className = "mask-toolbar-sep";
            toolbar.appendChild(sep);

            for (const { label, title, onClick } of buttons) {
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "mask-toolbar-btn";
                btn.textContent = label;
                btn.title = title;
                btn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    onClick();
                });
                toolbar.appendChild(btn);
            }

            container.appendChild(toolbar);
        }

        createToolbar();

        // ---- Eraser pen: deselect painted mask area while drawing ----
        //
        // Gradio 3.41.2's sketch tool (mask mode) is additive-only: strokes go
        // into an internal `lines` array, the mask is the pixels of
        // canvas[key="mask"], and the brush-color picker is not rendered in
        // mask mode. Instead of fighting that pipeline, the eraser works one
        // level down: every stroke Gradio draws passes through
        // CanvasRenderingContext2D.stroke() on the mask canvas, so wrapping
        // that method lets eraser strokes render with
        // globalCompositeOperation='destination-out' (erase) while paint
        // strokes use 'source-over'. Undo/clear keep working because they
        // replay the same wrapped path, and the component's own change
        // dispatch still ships the true mask pixels to the backend (whose
        // channel-0 threshold treats erased/transparent as deselected).
        //
        // The per-stroke journal mirrors Gradio's internal `lines` array so a
        // replay (undo) draws every stroke with its own composite even when
        // paint and eraser strokes are mixed. Journal sync points, all
        // verified against the Gradio 3.41.2 frontend source (Sketch.svelte,
        // Image.svelte, ModifySketch.svelte):
        //  - every finished stroke ends with saveLine() + save_mask_line(),
        //    each calling trigger_on_change() -> canvas.mask.toDataURL()
        //    (one journal entry pushed on the first of the two calls);
        //  - native Undo -> sketch.undo() -> redraw_image() -> clear_canvas()
        //    -> ctx.mask.clearRect(), then one draw_points() (== one
        //    stroke()) per remaining line, then trigger_on_change();
        //  - native Clear -> sketch.clear_mask() -> redraw_image([]) ->
        //    clear_canvas() -> ctx.mask.clearRect(), then trigger_on_change();
        //  - the native Undo/Clear clicks are observed in the capture phase
        //    so the journal pop/reset below happens before Gradio's
        //    synchronous replay runs.
        //  - clear_canvas() is ALSO called by clear(), which does NOT end
        //    with toDataURL() (mount, new image upload, value removed,
        //    resize). Those calls reset the journal; a replay armed by such
        //    a clearRect() is disarmed by the first stroke that finds the
        //    journal exhausted, so it is correctly treated as a live stroke.
        function ensureMaskFx() {
            const maskCanvas = targetElement.querySelector('canvas[key="mask"]');
            if (!maskCanvas) return null;
            if (maskCanvas.__fooocusFx) return maskCanvas.__fooocusFx;

            const ifaceCanvas = targetElement.querySelector('canvas[key="interface"]');
            const mctx = maskCanvas.getContext("2d");
            const fx = {
                mode: "pen",
                journal: [],
                replaying: false,
                replayIdx: 0,
                pendingPop: false,
                pendingClear: false,
                liveStroke: false,
                liveEraser: false,
            };

            const origStroke = mctx.stroke.bind(mctx);
            const origClearRect = mctx.clearRect.bind(mctx);
            const origToDataURL = maskCanvas.toDataURL.bind(maskCanvas);

            mctx.stroke = function () {
                if (fx.replaying && fx.replayIdx < fx.journal.length) {
                    // Genuine replay (undo/clear_mask): consume the matching
                    // journal entry so the stroke redraws with its own
                    // composite (eraser strokes re-erase).
                    const entry = fx.journal[fx.replayIdx++];
                    mctx.globalCompositeOperation =
                        entry.eraser ? "destination-out" : "source-over";
                } else {
                    // Live stroke. This branch also disarms a replay that was
                    // armed by a clearRect() Gradio never followed with
                    // strokes (clear() on mount / new image / resize resets
                    // the journal, so an exhausted journal means "not a
                    // replay").
                    fx.replaying = false;
                    const isEraser = fx.mode === "eraser";
                    mctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
                    fx.liveStroke = true;
                    fx.liveEraser = isEraser;
                }
                return origStroke();
            };

            mctx.clearRect = function (x, y, w, h) {
                const result = origClearRect(x, y, w, h);
                if (fx.pendingPop) {
                    fx.journal.pop();
                    fx.pendingPop = false;
                } else if (fx.pendingClear) {
                    fx.journal = [];
                    fx.pendingClear = false;
                } else {
                    fx.journal = [];
                }
                fx.replaying = true;
                fx.replayIdx = 0;
                fx.liveStroke = false;
                return result;
            };

            maskCanvas.toDataURL = function (...args) {
                if (fx.replaying) {
                    fx.replaying = false;
                } else if (fx.liveStroke) {
                    fx.journal.push({ eraser: fx.liveEraser });
                    fx.liveStroke = false;
                }
                mctx.globalCompositeOperation =
                    fx.mode === "eraser" ? "destination-out" : "source-over";
                return origToDataURL(...args);
            };

            fx.setMode = function (mode) {
                fx.mode = mode;
                // The interface canvas only ever shows the brush-preview
                // cursor, so inverting it turns the white preview ring black
                // in eraser mode: an honest cursor without extra elements.
                if (ifaceCanvas) ifaceCanvas.style.filter = mode === "eraser" ? "invert(1)" : "";
                syncFxButtons();
            };

            maskCanvas.__fooocusFx = fx;
            fx.setMode("pen");
            return fx;
        }

        function syncFxButtons() {
            const refs = targetElement._maskFxBtnRefs;
            if (!refs) return;
            const maskCanvas = targetElement.querySelector('canvas[key="mask"]');
            const fx = maskCanvas && maskCanvas.__fooocusFx;
            const isEraser = !!fx && fx.mode === "eraser";
            refs.penBtn.classList.toggle("active", !isEraser);
            refs.eraserBtn.classList.toggle("active", isEraser);
            refs.penBtn.setAttribute("aria-pressed", String(!isEraser));
            refs.eraserBtn.setAttribute("aria-pressed", String(isEraser));
        }

        // One capture-phase click hook per canvas root: flags an observed
        // native Undo/Clear click before Gradio's synchronous replay runs.
        // Looks the fx state up live so canvas remounts (new uploads) work.
        if (!targetElement.__fooocusFxClickHook) {
            targetElement.__fooocusFxClickHook = true;
            targetElement.addEventListener("click", (e) => {
                const btn = e.target && e.target.closest
                    ? e.target.closest('button[aria-label="Undo"],button[aria-label="Clear"]')
                    : null;
                if (!btn) return;
                const maskCanvas = targetElement.querySelector('canvas[key="mask"]');
                const fx = maskCanvas && maskCanvas.__fooocusFx;
                if (!fx) return;
                if (btn.getAttribute("aria-label") === "Undo") fx.pendingPop = true;
                else fx.pendingClear = true;
            }, true);
        }

        ensureMaskFx();
        syncFxButtons();

        // Reset the zoom level and pan position of the target element to their initial values
        function resetZoom() {
            elemData[elemId] = {
                zoomLevel: 1,
                panX: 0,
                panY: 0
            };

            targetElement.style.overflow = "hidden";

            targetElement.isZoomed = false;

            targetElement.style.transform = `scale(${elemData[elemId].zoomLevel}) translate(${elemData[elemId].panX}px, ${elemData[elemId].panY}px)`;

            const canvas = gradioApp().querySelector(
                `${elemId} canvas[key="interface"]`
            );

            toggleOverlap("off");
            fullScreenMode = false;

            const closeBtn = targetElement.querySelector("button[aria-label='Remove Image']");
            if (closeBtn) {
                closeBtn.addEventListener("click", resetZoom);
            }

            if (canvas) {
                const parentElement = targetElement.closest('[id^="component-"]');
                if (
                    canvas &&
                    parseFloat(canvas.style.width) > parentElement.offsetWidth &&
                    parseFloat(targetElement.style.width) > parentElement.offsetWidth
                ) {
                    fitToElement();
                    return;
                }

            }

            targetElement.style.width = "";
        }

        // Toggle the zIndex of the target element between two values, allowing it to overlap or be overlapped by other elements
        function toggleOverlap(forced = "") {
            const zIndex1 = "0";
            const zIndex2 = "998";

            targetElement.style.zIndex =
                targetElement.style.zIndex !== zIndex2 ? zIndex2 : zIndex1;

            if (forced === "off") {
                targetElement.style.zIndex = zIndex1;
            } else if (forced === "on") {
                targetElement.style.zIndex = zIndex2;
            }
        }

        // Adjust the brush size based on the deltaY value from a mouse wheel event
        function adjustBrushSize(
            elemId,
            deltaY,
            withoutValue = false,
            percentage = 5
        ) {
            const input =
                gradioApp().querySelector(
                    `${elemId} input[aria-label='Brush radius']`
                ) ||
                gradioApp().querySelector(
                    `${elemId} button[aria-label="Use brush"]`
                );

            if (input) {
                input.click();
                if (!withoutValue) {
                    const maxValue =
                        parseFloat(input.getAttribute("max")) || 100;
                    const changeAmount = maxValue * (percentage / 100);
                    const newValue =
                        parseFloat(input.value) +
                        (deltaY > 0 ? -changeAmount : changeAmount);
                    input.value = Math.min(Math.max(newValue, 0), maxValue);
                    input.dispatchEvent(new Event("change"));
                }
            }
        }

        // Reset zoom when uploading a new image
        const fileInput = gradioApp().querySelector(
            `${elemId} input[type="file"][accept="image/*"].svelte-116rqfv`
        );
        fileInput.addEventListener("click", resetZoom);

        // Update the zoom level and pan position of the target element based on the values of the zoomLevel, panX and panY variables
        function updateZoom(newZoomLevel, mouseX, mouseY) {
            newZoomLevel = Math.max(0.1, Math.min(newZoomLevel, 15));

            elemData[elemId].panX +=
                mouseX - (mouseX * newZoomLevel) / elemData[elemId].zoomLevel;
            elemData[elemId].panY +=
                mouseY - (mouseY * newZoomLevel) / elemData[elemId].zoomLevel;

            targetElement.style.transformOrigin = "0 0";
            targetElement.style.transform = `translate(${elemData[elemId].panX}px, ${elemData[elemId].panY}px) scale(${newZoomLevel})`;
            targetElement.style.overflow = "visible";

            toggleOverlap("on");
 
            return newZoomLevel;
        }

        // Zoom centered on a client (screen) point. Used by both the
        // Shift+wheel hotkey and the toolbar buttons.
        function doZoom(operation, clientX, clientY) {
            let zoomPosX, zoomPosY;
            let delta = 0.2;

            if (elemData[elemId].zoomLevel > 7) {
                delta = 0.9;
            } else if (elemData[elemId].zoomLevel > 2) {
                delta = 0.6;
            }

            zoomPosX = clientX;
            zoomPosY = clientY;

            fullScreenMode = false;
            elemData[elemId].zoomLevel = updateZoom(
                elemData[elemId].zoomLevel +
                (operation === "+" ? delta : -delta),
                zoomPosX - targetElement.getBoundingClientRect().left,
                zoomPosY - targetElement.getBoundingClientRect().top
            );

            targetElement.isZoomed = true;
        }

        // Change the zoom level based on user interaction
        function changeZoomLevel(operation, e) {
            if (isModifierKey(e, hotkeysConfig.canvas_hotkey_zoom)) {
                e.preventDefault();
                doZoom(operation, e.clientX, e.clientY);
            }
        }

        /**
         * This function fits the target element to the screen by calculating
         * the required scale and offsets. It also updates the global variables
         * zoomLevel, panX, and panY to reflect the new state.
         */

        function fitToElement() {
            //Reset Zoom
            targetElement.style.transform = `translate(${0}px, ${0}px) scale(${1})`;

            let parentElement;

            parentElement = targetElement.closest('[id^="component-"]');

            // Get element and screen dimensions
            const elementWidth = targetElement.offsetWidth;
            const elementHeight = targetElement.offsetHeight;

            const screenWidth = parentElement.clientWidth - 24;
            const screenHeight = parentElement.clientHeight;

            // Calculate scale and offsets
            const scaleX = screenWidth / elementWidth;
            const scaleY = screenHeight / elementHeight;
            const scale = Math.min(scaleX, scaleY);

            const offsetX =0;
            const offsetY =0;

            // Apply scale and offsets to the element
            targetElement.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

            // Update global variables
            elemData[elemId].zoomLevel = scale;
            elemData[elemId].panX = offsetX;
            elemData[elemId].panY = offsetY;

            fullScreenMode = false;
            toggleOverlap("off");
        }

        // Undo last action
        function undoLastAction(e) {
            let isCtrlPressed = isModifierKey(e, hotkeysConfig.canvas_zoom_undo_extra_key)
            const isAuxButton = e.button >= 3;
            
            if (isAuxButton) {
              isCtrlPressed = true
            } else {
              if (!isModifierKey(e, hotkeysConfig.canvas_zoom_undo_extra_key)) return;
            }

            // Move undoBtn query outside the if statement to avoid unnecessary queries
            const undoBtn = document.querySelector(`${activeElement} button[aria-label="Undo"]`);
        
            if ((isCtrlPressed) && undoBtn ) {
                e.preventDefault();
                undoBtn.click();
            }
        }

        /**
         * This function fits the target element to the screen by calculating
         * the required scale and offsets. It also updates the global variables
         * zoomLevel, panX, and panY to reflect the new state.
         */

        // Fullscreen mode
        function fitToScreen() {
            const canvas = gradioApp().querySelector(
                `${elemId} canvas[key="interface"]`
            );

            if (!canvas) return;

            targetElement.style.width = (canvas.offsetWidth + 2) + "px";
            targetElement.style.overflow = "visible";

            if (fullScreenMode) {
                resetZoom();
                fullScreenMode = false;
                return;
            }

            //Reset Zoom
            targetElement.style.transform = `translate(${0}px, ${0}px) scale(${1})`;

            // Get scrollbar width to right-align the image
            const scrollbarWidth =
                window.innerWidth - document.documentElement.clientWidth;

            // Get element and screen dimensions
            const elementWidth = targetElement.offsetWidth;
            const elementHeight = targetElement.offsetHeight;
            const screenWidth = window.innerWidth - scrollbarWidth;
            const screenHeight = window.innerHeight;

            // Get element's coordinates relative to the page
            const elementRect = targetElement.getBoundingClientRect();
            const elementY = elementRect.y;
            const elementX = elementRect.x;

            // Calculate scale and offsets
            const scaleX = screenWidth / elementWidth;
            const scaleY = screenHeight / elementHeight;
            const scale = Math.min(scaleX, scaleY);

            // Get the current transformOrigin
            const computedStyle = window.getComputedStyle(targetElement);
            const transformOrigin = computedStyle.transformOrigin;
            const [originX, originY] = transformOrigin.split(" ");
            const originXValue = parseFloat(originX);
            const originYValue = parseFloat(originY);

            // Calculate offsets with respect to the transformOrigin
            const offsetX =
                (screenWidth - elementWidth * scale) / 2 -
                elementX -
                originXValue * (1 - scale);
            const offsetY =
                (screenHeight - elementHeight * scale) / 2 -
                elementY -
                originYValue * (1 - scale);

            // Apply scale and offsets to the element
            targetElement.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

            // Update global variables
            elemData[elemId].zoomLevel = scale;
            elemData[elemId].panX = offsetX;
            elemData[elemId].panY = offsetY;

            fullScreenMode = true;
            toggleOverlap("on");
        }

        // Handle keydown events
        function handleKeyDown(event) {
            // Disable key locks to make pasting from the buffer work correctly
            if ((event.ctrlKey && event.code === 'KeyV') || (event.ctrlKey && event.code === 'KeyC') || event.code === "F5") {
                return;
            }

            // before activating shortcut, ensure user is not actively typing in an input field
            if (!hotkeysConfig.canvas_blur_prompt) {
                if (event.target.nodeName === 'TEXTAREA' || event.target.nodeName === 'INPUT') {
                    return;
                }
            }

            const hotkeyActions = {
                [hotkeysConfig.canvas_hotkey_reset]: resetZoom,
                [hotkeysConfig.canvas_hotkey_overlap]: toggleOverlap,
                [hotkeysConfig.canvas_hotkey_fullscreen]: fitToScreen,
                [hotkeysConfig.canvas_zoom_hotkey_undo]: undoLastAction,
            };

            const action = hotkeyActions[event.code];
            if (action) {
                event.preventDefault();
                action(event);
            }

            if (
                isModifierKey(event, hotkeysConfig.canvas_hotkey_zoom) ||
                isModifierKey(event, hotkeysConfig.canvas_hotkey_adjust)
            ) {
                event.preventDefault();
            }
        }

        // Get Mouse position
        function getMousePosition(e) {
            mouseX = e.offsetX;
            mouseY = e.offsetY;
        }

        // Simulation of the function to put a long image into the screen.
        // We detect if an image has a scroll bar or not, make a fullscreen to reveal the image, then reduce it to fit into the element.
        // We hide the image and show it to the user when it is ready.

        targetElement.isExpanded = false;
        function autoExpand() {
            const canvas = document.querySelector(`${elemId} canvas[key="interface"]`);
            if (canvas) {
                if (hasHorizontalScrollbar(targetElement) && targetElement.isExpanded === false) {
                    targetElement.style.visibility = "hidden";
                    setTimeout(() => {
                        fitToScreen();
                        resetZoom();
                        targetElement.style.visibility = "visible";
                        targetElement.isExpanded = true;
                    }, 10);
                }
            }
        }

        targetElement.addEventListener("mousemove", getMousePosition);
        targetElement.addEventListener("auxclick", undoLastAction);

        //observers
        // Creating an observer with a callback function to handle DOM changes
        const observer = new MutationObserver((mutationsList, observer) => {
            for (let mutation of mutationsList) {
              // If the style attribute of the canvas has changed, by observation it happens only when the picture changes
              if (mutation.type === 'attributes' && mutation.attributeName === 'style' &&
                mutation.target.tagName.toLowerCase() === 'canvas') {
                targetElement.isExpanded = false;
                setTimeout(resetZoom, 10);
                setTimeout(createToolbar, 50);
              }
              // Canvases can be recreated on component remounts: (re)install
              // the eraser compositing hooks whenever the DOM changes.
              if (mutation.type === 'childList') {
                ensureMaskFx();
                syncFxButtons();
              }
            }
          });
      
          // Apply auto expand if enabled
          if (hotkeysConfig.canvas_auto_expand) {
            targetElement.addEventListener("mousemove", autoExpand);
            // Set up an observer to track attribute changes
            observer.observe(targetElement, { attributes: true, childList: true, subtree: true });
          }

        // Handle events only inside the targetElement
        let isKeyDownHandlerAttached = false;

        function handleMouseMove() {
            if (!isKeyDownHandlerAttached) {
                document.addEventListener("keydown", handleKeyDown);
                isKeyDownHandlerAttached = true;

                activeElement = elemId;
            }
        }

        function handleMouseLeave() {
            if (isKeyDownHandlerAttached) {
                document.removeEventListener("keydown", handleKeyDown);
                isKeyDownHandlerAttached = false;

                activeElement = null;
            }
        }

        // Add mouse event handlers
        targetElement.addEventListener("mousemove", handleMouseMove);
        targetElement.addEventListener("mouseleave", handleMouseLeave);

        targetElement.addEventListener("wheel", e => {
            // change zoom level
            const operation = e.deltaY > 0 ? "-" : "+";
            changeZoomLevel(operation, e);

            // Handle brush size adjustment with ctrl key pressed
            if (isModifierKey(e, hotkeysConfig.canvas_hotkey_adjust)) {
                e.preventDefault();

                // Increase or decrease brush size based on scroll direction
                adjustBrushSize(elemId, e.deltaY);
            }
        });

        // Handle the move event for pan functionality. Updates the panX and panY variables and applies the new transform to the target element.
        function handleMoveKeyDown(e) {

            // Disable key locks to make pasting from the buffer work correctly
            if ((e.ctrlKey && e.code === 'KeyV') || (e.ctrlKey && e.code === 'KeyC') || e.code === "F5") {
                return;
            }

            // before activating shortcut, ensure user is not actively typing in an input field
            if (!hotkeysConfig.canvas_blur_prompt) {
                if (e.target.nodeName === 'TEXTAREA' || e.target.nodeName === 'INPUT') {
                    return;
                }
            }


            if (e.code === hotkeysConfig.canvas_hotkey_move) {
                if (!e.ctrlKey && !e.metaKey && isKeyDownHandlerAttached) {
                    e.preventDefault();
                    document.activeElement.blur();
                    isMoving = true;
                }
            }
        }

        function handleMoveKeyUp(e) {
            if (e.code === hotkeysConfig.canvas_hotkey_move) {
                isMoving = false;
            }
        }

        document.addEventListener("keydown", handleMoveKeyDown);
        document.addEventListener("keyup", handleMoveKeyUp);

        // Detect zoom level and update the pan speed.
        function updatePanPosition(movementX, movementY) {
            let panSpeed = 2;

            if (elemData[elemId].zoomLevel > 8) {
                panSpeed = 3.5;
            }

            elemData[elemId].panX += movementX * panSpeed;
            elemData[elemId].panY += movementY * panSpeed;

            // Delayed redraw of an element
            requestAnimationFrame(() => {
                targetElement.style.transform = `translate(${elemData[elemId].panX}px, ${elemData[elemId].panY}px) scale(${elemData[elemId].zoomLevel})`;
                toggleOverlap("on");
            });
        }

        function handleMoveByKey(e) {
            if (isMoving && elemId === activeElement) {
                updatePanPosition(e.movementX, e.movementY);
                targetElement.style.pointerEvents = "none";
                targetElement.style.overflow = "visible";
            } else {
                targetElement.style.pointerEvents = "auto";
            }
        }

        // Prevents sticking to the mouse
        window.onblur = function() {
            isMoving = false;
        };

        // Checks for extension
        function checkForOutBox() {
            const parentElement = targetElement.closest('[id^="component-"]');
            if (parentElement.offsetWidth < targetElement.offsetWidth && !targetElement.isExpanded) {
                resetZoom();
                targetElement.isExpanded = true;
            }

            if (parentElement.offsetWidth < targetElement.offsetWidth && elemData[elemId].zoomLevel == 1) {
                resetZoom();
            }

            if (parentElement.offsetWidth < targetElement.offsetWidth && targetElement.offsetWidth * elemData[elemId].zoomLevel > parentElement.offsetWidth && elemData[elemId].zoomLevel < 1 && !targetElement.isZoomed) {
                resetZoom();
            }
        }

        targetElement.addEventListener("mousemove", checkForOutBox);

        window.addEventListener('resize', (e) => {
            resetZoom();

            targetElement.isExpanded = false;
            targetElement.isZoomed = false;
        });

        gradioApp().addEventListener("mousemove", handleMoveByKey);
    }

    applyZoomAndPan("#inpaint_canvas");
    applyZoomAndPan("#inpaint_mask_canvas");
});
