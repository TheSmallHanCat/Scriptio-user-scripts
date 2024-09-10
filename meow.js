// @name         统统变猫娘
// @description  将自己或其他人的关键字替换成猫娘语
// @version      1.0.0
// @author       TheSmallHanCat

(function () {
    const targetClass = "text-normal";

    function replaceText(text) {
        return text
        .replace(/我们/g, "咱喵和其它猫猫们")
        .replace(/大家/g, "各位猫猫们")
        .replace(/(?<!自|本)我/g, "咱喵");
    }

    function replaceInSpans() {
        const spanElements = document.querySelectorAll(`span.${targetClass}`);
        spanElements.forEach(span => {
            span.textContent = replaceText(span.textContent);
        });
    }

    function observeMutations() {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && node.matches(`span.${targetClass}`)) {
                            node.textContent = replaceText(node.textContent);
                        } else if (node.nodeType === 1) {
                            node.querySelectorAll(`span.${targetClass}`).forEach(span => {
                                span.textContent = replaceText(span.textContent);
                            });
                        }
                    });
                }
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // 初始替换
    replaceInSpans();

    // 观察DOM变动并替换新增的内容
    observeMutations();
})();
