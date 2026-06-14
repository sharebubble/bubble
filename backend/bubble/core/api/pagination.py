from rest_framework.pagination import PageNumberPagination


class SelectablePageSizePagination(PageNumberPagination):
    """Page-number pagination that lets the client pick the page size.

    Enables the ``?page_size=`` query parameter so views can offer a
    user-selectable number of results per page (e.g. 10 / 20 / 50 on the
    bookings agenda) while still defaulting to the project-wide ``PAGE_SIZE``.
    """

    page_size_query_param = "page_size"
    max_page_size = 100
