## **A. Deep Search and Document Reading**

| ID | Page / Environment | Goal | What It Tests   |
| :---- | :---- | :---- | :---- |
| rfc-deep-read | RFC Editor — RFC 9110, “HTTP Semantics” | Find the section that defines HTTP status 404; provide its number and exact title. **Correct answer:** § 15.5.5 — “404 Not Found”. | Reaching information deep inside a very long document; searching, pagination, and handling a large snapshot. |
| rfc-header-semantics | RFC Editor — RFC 9110 | Find the definition of the Accept header, provide the section number, and explain its function. | Searching for a technical concept and reading its definition in context. |
| rfc-cache-conditions | RFC Editor — RFC 9111 | Find Cache-Control: no-store and state its operating rule. | Extracting a specific directive from a long specification. |
| html-spec-dialog | HTML Standard | Find the description of showModal() for the dialog element and state the effect of calling it. | API search in an extensive specification. |
| mdn-fetch-abort | MDN — Fetch API / AbortController documentation | Find how to cancel a fetch() request and identify the mechanism used. | Connecting API documentation with a code example. |
| python-exception-chain | Python documentation — raise statement | Find the raise ... from ... syntax and describe its purpose. | Reading the semantics of programming-language syntax. |
| kubernetes-probe-types | Kubernetes documentation — configuring liveness, readiness, and startup probes | Provide the three probe types. | Extracting a complete list from technical documentation. |
| postgres-index-types | PostgreSQL documentation — indexes | List the available index types and identify the one suitable for full-text search. | Selecting information from a technical table or list. |
| openssl-cipher-option | OpenSSL documentation — encryption command | Explain the meaning of the \-cipher option. | Finding and interpreting a CLI argument. |
| wcag-focus-order | WCAG 2.2 — “Focus Order” criterion | Find the criterion, provide its number, and its conformance level. | Precisely locating a standard and its metadata. |

## 

## 

## **B. SPA Application Interaction**

| ID | Page / Environment | Goal | What It Tests   |
| :---- | :---- | :---- | :---- |
| spa-todomvc | TodoMVC demo in Playwright | Add alpha, beta, and gamma; mark beta as completed; click the “Active” filter; report the counter and visible tasks. **Correct answer:** “2 items left”; alpha and gamma. | Multi-step interaction with a React application, handle persistence after DOM changes, and action batching. |
| spa-todo-edit-filter | Local TodoMVC instance or demo Playwright app | Add four tasks, rename one, complete two, and display active tasks only. | Editing, state changes, and list filtering. |
| spa-kanban-move-card | Local test Kanban app, e.g. a demo application | Create a card in “To Do,” move it to “In Progress,” and set high priority. | Multi-step interaction and changes to views or columns. |
| spa-shopping-cart | Local demo shop | Add two products to the cart, change one product’s quantity to 3, and remove the other. | Dynamic cart updates and quantity controls. |
| spa-tabs-persistence | Local settings application | Open “Notifications,” select two channels, and return to “Profile.” | Switching tabs without reloads and retaining state. |
| spa-search-sort | Local product catalogue | Search for a phrase, sort by ascending price, and provide the first result. | Combining search, sorting, and reading a dynamic list. |
| spa-pagination | Local application with paginated results | Go to page 3, open an item’s details, and return to the list. | SPA pagination, view navigation, and context preservation. |
| spa-notification-settings | Local settings panel | Disable email, enable push, save, and read the confirmation. | Toggles, saving, and success messages. |
| spa-modal-confirmation | Local project-management app | Open the deletion modal, cancel first, then confirm deletion of the specified project. | Modal handling and distinguishing cancellation from confirmation. |
| spa-validation-inline | Local React/Vue form | Enter an invalid email, read the error, correct it, and submit the form. | Dynamic validation and the error → correction → success sequence. |

## 

## **C. Forms and Post-Submit Navigation**

| ID | Page / Environment | Goal | What It Tests   |
| :---- | :---- | :---- | :---- |
| web-form | Selenium — form test | Enter “Jan Kowalski” in the text field and secret1 in the password field, then click Submit. Report the heading and message on the result page. **Correct answer:** “Form submitted” / “Received\!”. | Finding fields, typing, submitting a form, and handling navigation that invalidates old handles. |
| form-registration-success | Local registration form or Selenium demo page | Fill in valid data and read the success message. | Recognising form fields and moving to a confirmation view. |
| form-required-field-error | Local contact form | Submit without a subject, read the error, complete the subject, and submit again. | Required-field validation and recovery after an error. |
| form-address-select | Local delivery form | Fill in an address, choose a region, and select courier delivery. | Text fields, select controls, and radio buttons. |
| form-date-range | Local reservation form | Set start and end dates, submit, and provide the number of days. | Date fields and dependencies between values. |
| form-upload-metadata | Custom test application with a non-confidential sample file | Attach a non-confidential test file, enter a title, and submit. | File upload, metadata, and post-submit messaging. |
| form-password-confirmation | Local password-change page | Enter different passwords, read the error, correct the confirmation, and complete the password change. | Validation dependencies between fields. |
| form-multistep-checkout | Local test checkout with no real payment | Enter customer details, delivery details, and a test payment method; report the summary. | Multi-step forms and state transfer between steps. |
| form-consent-checkboxes | Local newsletter or registration form | Select terms acceptance, leave marketing consent unchecked, and submit. | Distinguishing mandatory from optional consent. |
| form-search-redirect | Demo search engine or local catalogue | Search for a phrase, submit, and report the number of results and the first result. | Redirecting to results and extracting data after submission. |

## 

## **D. Tabular Data Extraction**

| ID | Page / Environment | Goal | What It Tests   |
| :---- | :---- | :---- | :---- |
| table-extract | Wikipedia — “List of chemical elements” | Find tungsten and provide its atomic number, symbol, and standard atomic weight. **Correct answer:** 74 · W · 183.84. | Table fidelity after snapshot compression; retaining separators and correctly reading one row from a large table. |
| table-country-population | Wikipedia country table or custom statistics page | For Japan, provide population, capital, and ISO code. | Reading several columns from one row. |
| table-currency-rates | Test currency-exchange table | Provide EUR, USD, and CHF exchange rates against PLN. | Extracting several numeric records. |
| table-software-releases | Project documentation with a releases table | For a specified version, provide release date and support status. | Reading records by identifier. |
| table-movie-ratings | Local movie catalogue or public-data table | For 2019, find the highest-rated film and provide title, rating, and director. | Filtering, comparing values, and reading related columns. |
| table-airport-codes | Wikipedia airport table or local dataset | For Keflavík Airport, provide IATA code, city, and country. | Searching names with diacritics in wide tables. |
| table-nutrition-values | Test nutrition table | For oatmeal, provide calories, protein, and fibre per serving. | Interpreting units and distinguishing “per serving” from “per 100 g.” |
| table-financial-summary | Local quarterly-results table | For Q2 of the specified year, provide revenue, cost, and margin. | Financial data, percentages, and number separators. |
| table-university-rankings | Public or local university ranking | For the specified university, provide rank, country, and score. | Long tables and precise record matching. |
| table-train-timetable | Local train timetable | For the specified train number, provide departure station, arrival station, and platform. | Schedule data, times, and correlating several columns. |

## 

## **E. Cross-Page Navigation Through Links**

| ID | Page / Environment | Goal | What It Tests   |
| :---- | :---- | :---- | :---- |
| wiki-journey | Wikipedia — “Moon” → “Giant-impact hypothesis” | From the Moon article, follow the link to “Giant-impact hypothesis” without manually entering an address, then provide the estimated time of the collision. **Correct answer:** approximately 4.5 billion years ago. | Finding the right link in a complex page, navigation, and handling a full document change. |
| shop-navigate | Books to Scrape — Travel category | Click the Travel category and provide the number of results, the title, and price of the least expensive book. **Correct answer:** 11 results; “The Road to Little Dribbling…”; £23.21. | Click-based navigation, list extraction, retaining multiple prices, and selecting the minimum. |
| wiki-science-chain | Wikipedia — Photosynthesis → Calvin cycle | Follow the link to “Calvin cycle” and provide the main product of that stage. | Finding a link in a long article and extracting a fact after navigation. |
| docs-api-reference | Documentation for a selected API | From the main documentation, navigate to a method reference and provide the required parameter. | Navigating a documentation hierarchy and distinguishing required parameters. |
| shop-category-product | Books to Scrape or local demo shop | Navigate from a catalogue to a category, open a product, and provide price and availability. | Multi-step catalogue-to-product navigation. |
| news-article-source | Custom test news site with articles and cited sources | Open the specified article, then click a source cited in its text. | Finding contextual links and verifying the navigation path. |
| knowledge-base-article | Test product help centre | Open the password-reset article and provide the first step of the procedure. | Navigating support categories and extracting instructions. |
| repository-readme-guide | Test documentation repository | From the README, go to installation instructions and provide system requirements. | Handling relative links and navigating documentation files. |
| travel-destination-details | Test travel catalogue | Navigate from a destination through a city to an attraction and provide opening hours. | Multi-level navigation and extracting object metadata. |
| course-module-lesson | Test learning platform | From the course list, navigate to a module and lesson; provide its duration and topic. | Hierarchical navigation and reading lesson details. |
| government-service-procedure | Test public-services portal | Select a procedure, open details, and identify the required document. | Accurate link navigation and extraction of a formal requirement. |

