# Estado de implementación — SPEC 02

- **Spec:** `specs/02-pages-cms-traducciones-opcionales.md`
- **Estado de la spec:** Approved
- **Rama activa:** `spec-02-pages-cms-traducciones-opcionales`
- **AutoCreateBranch:** true
- **AutoCommitSteps:** false (sin commits automáticos)
- **Última actualización:** 2026-11-25

## Progreso

- [x] 1. Crear/rellenar `.pages.yml` con media, settings y ambas colecciones.
- [x] 2. `scripts/check-posts.mjs`: falta de pareja = aviso; `lang` incorrecto sigue siendo error.
- [x] 3. Añadir `getPostLanguages(id)` a `src/lib/posts.ts`.
- [x] 4. `BaseLayout.astro`: idiomas disponibles, `hreflang`, `x-default`, `og:locale:alternate` y `languageUrl`.
- [x] 5. `Navigation.vue`: recibir `languageUrl` como prop.
- [x] 6. Fallback del selector al listado `/posts/` del otro idioma.
- [x] 7. Filtrar `links` del sitemap en `astro.config.mjs`.
- [ ] 8. Actualizar `README.md`.
- [ ] 9. Ampliar `tests/blog.spec.ts`.
- [ ] 10. Probar Pages CMS en la rama (login, edición, imagen, post de un idioma, rename/delete).
- [ ] 11. `format:check`, `check`, `build`, `test:e2e` y limpieza del contenido de prueba.

## Contexto

- `.pages.yml` ya existía en `master` pero estaba vacío (0 bytes). El paso 1 lo rellena.
- `src/content/posts/{en,es}/prueba-nuevo-post.md` son posts de prueba creados con Pages CMS. Confirmar antes de borrarlos en el paso 11.
- Paso 1 completado y commiteado como `spec-02-step-01`: `.pages.yml` relleno con `media`, `settings` y las dos colecciones. `pnpm build` pasa.
- Paso 2 completado y commiteado como `spec-02-step-02`: `check-posts` avisa de posts publicados sin traducción, ignora borradores sin pareja y sigue fallando si `lang` no coincide con la carpeta.
- Paso 3 completado y commiteado como `spec-02-step-03`: `getPostLanguages(id)` devuelve los idiomas con un post publicado para ese slug. `pnpm check` pasa.
- Paso 4 completado y commiteado como `spec-02-step-04`: `BaseLayout` limita `hreflang`, `x-default` y `og:locale:alternate` a idiomas publicados. El paso de `languageUrl` a `Navigation` se movió al paso 5 porque `astro check` rechaza la prop antes de declararla.
- Paso 5 completado y commiteado como `spec-02-step-05`: `Navigation` recibe `languageUrl` y `BaseLayout` la calcula con la ruta actual.
- Paso 6 completado y commiteado como `spec-02-step-06`: si no existe traducción publicada, el selector va al listado `/posts/` del otro idioma.
- Paso 7 completado (sin commitear): el sitemap filtra los `links` alternativos contra las páginas publicadas reales.
- El árbol de trabajo estaba limpio al crear la rama.

## Siguiente acción

Commitear el paso 7 y continuar con el paso 8 (`README.md`). Para retomar:

```text
/spec-impl 02-pages-cms-traducciones-opcionales
```
