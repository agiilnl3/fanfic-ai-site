import { useState, useEffect } from "react";

export function useAuthor() {
  const [authorName, setAuthorName] = useState<string>(() => {
    return localStorage.getItem("fanfic_author") || "";
  });

  useEffect(() => {
    if (authorName) {
      localStorage.setItem("fanfic_author", authorName);
    } else {
      localStorage.removeItem("fanfic_author");
    }
  }, [authorName]);

  return { authorName, setAuthorName };
}
