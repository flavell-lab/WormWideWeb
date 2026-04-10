const TOC_LINK_SELECTOR = "[data-toc-link]";
const ACTIVE_CLASS = "active";

function setActiveLink(links, targetId) {
    links.forEach((link) => {
        const href = link.getAttribute("href") || "";
        const isActive = href === `#${targetId}`;
        link.classList.toggle(ACTIVE_CLASS, isActive);
    });
}

function initAboutToc() {
    const links = Array.from(document.querySelectorAll(TOC_LINK_SELECTOR));
    if (!links.length) return;

    const sections = links
        .map((link) => {
            const href = link.getAttribute("href") || "";
            if (!href.startsWith("#")) return null;
            const section = document.querySelector(href);
            if (!section) return null;
            return { id: href.slice(1), section };
        })
        .filter(Boolean);

    if (!sections.length) return;

    const visible = new Map();
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                const id = entry.target.id;
                if (entry.isIntersecting) {
                    visible.set(id, entry.intersectionRatio);
                } else {
                    visible.delete(id);
                }
            });

            if (!visible.size) return;
            const [nextId] = [...visible.entries()].sort((left, right) => {
                if (right[1] !== left[1]) return right[1] - left[1];
                return sections.findIndex((item) => item.id === left[0]) -
                    sections.findIndex((item) => item.id === right[0]);
            })[0];
            setActiveLink(links, nextId);
        },
        {
            root: null,
            rootMargin: "-25% 0px -60% 0px",
            threshold: [0, 0.15, 0.35, 0.6, 0.9],
        }
    );

    sections.forEach(({ section }) => observer.observe(section));

    links.forEach((link) => {
        link.addEventListener("click", () => {
            const href = link.getAttribute("href") || "";
            if (href.startsWith("#")) {
                setActiveLink(links, href.slice(1));
            }
        });
    });

    const initialHash = (window.location.hash || "").replace("#", "");
    const initialId = sections.some((item) => item.id === initialHash)
        ? initialHash
        : sections[0].id;
    setActiveLink(links, initialId);
}

document.addEventListener("DOMContentLoaded", initAboutToc);
