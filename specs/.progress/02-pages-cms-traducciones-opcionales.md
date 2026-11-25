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
- [ ] 3. Añadir `getPostLanguages(id)` a `src/lib/posts.ts`.
- [ ] 4. `BaseLayout.astro`: idiomas disponibles, `hreflang`, `x-default`, `og:locale:alternate` y `languageUrl`.
- [ ] 5. `Navigation.vue`: recibir `languageUrl` como prop.
- [ ] 6. Fallback del selector al listado `/posts/` del otro idioma.
- [ ] 7. Filtrar `links` del sitemap en `astro.config.mjs`.
- [ ] 8. Actualizar `README.md`.
- [ ] 9. Ampliar `tests/blog.spec.ts`.
- [ ] 10. Probar Pages CMS en la rama (login, edición, imagen, post de un idioma, rename/delete).
- [ ] 11. `format:check`, `check`, `build`, `test:e2e` y limpieza del contenido de prueba.

## Contexto

- `.pages.yml` ya existía en `master` pero estaba vacío (0 bytes). El paso 1 lo rellena.
- `src/content/posts/{en,es}/prueba-nuevo-post.md` son posts de prueba creados con Pages CMS. Confirmar antes de borrarlos en el paso 11.
- Paso 1 completado y commiteado como `spec-02-step-01`: `.pages.yml` relleno con `media`, `settings` y las dos colecciones. `pnpm build` pasa.
- Paso 2 completado (sin commitear): `check-posts` avisa de posts publicados sin traducción, ignora borradores sin pareja y sigue fallando si `lang` no coincide con la carpeta.
- El árbol de trabajo estaba limpio al crear la rama.

## Siguiente acción

Pedir confirmación para empezar el paso 1. Para retomar:

```text
/spec-impl 02-pages-cms-traducciones-opcionales
```
