<script>
document.addEventListener('DOMContentLoaded', function() {
    // Convert given phone number to the format +12345678901
    function formatPhoneNumber(number) {
        let cleaned = ('' + number).replace(/\D/g, '');
        let match = cleaned.match(/^1?(\d{10})$/);
        if (match) {
            return '+1' + match[1];
        }
        return null;
    }

    const klaviyoForms = document.querySelectorAll('.klaviyo-form');

    klaviyoForms.forEach((form) => {
        form.addEventListener('submit', function(event) {
            // Always prevent the default form submission
            event.preventDefault();

            // Form Data Extraction
            const formData = new FormData(form);
            const attributes = {};
            const standardAttributes = ["email", "phone_number", "external_id", "anonymous_id", "_kx", "first_name", "last_name", "organization", "title", "image"];
            const nestedObjects = {
                "location": ["address1", "address2", "city", "country", "region", "zip", "timezone", "ip"]
            };

            for (let [key, value] of formData.entries()) {
                if (standardAttributes.includes(key)) {
                    attributes[key] = value;
                } else {
                    let addedToNested = false;
                    for (const [objectName, fields] of Object.entries(nestedObjects)) {
                        if (fields.includes(key)) {
                            if (!attributes[objectName]) attributes[objectName] = {};
                            attributes[objectName][key] = value;
                            addedToNested = true;
                            break;
                        }
                    }
                    if (!addedToNested) {
                        if (!attributes.properties) attributes.properties = {};
                        attributes.properties[key] = value;
                    }
                }
            }

            // Phone Number Formatting
            if (attributes.phone_number) {
                attributes.phone_number = formatPhoneNumber(attributes.phone_number);
                if (!attributes.phone_number) {
                    console.error('Error: Invalid phone number format.');
                    let customErrorElement = form.querySelector('.custom-error');
                    if (customErrorElement) {
                        customErrorElement.textContent = 'Invalid phone number format. Please use a format like 123-456-7890 or 1234567890.';
                        customErrorElement.style.display = 'block';
                    }
                    return;
                }
            }

            // Klaviyo API Configuration
            const klaviyoListId = form.getAttribute("data-klaviyo-list-id");
            const options = {
                method: 'POST',
                headers: {
                    'revision': '2023-08-15',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    data: {
                        type: 'subscription',
                        attributes: {
                            custom_source: form.getAttribute("data-name"),
                            profile: {
                                data: {
                                    type: 'profile',
                                    attributes: attributes
                                }
                            }
                        },
                        relationships: { list: { data: { type: 'list', id: klaviyoListId }}}
                    }
                })
            };

            // Klaviyo API Call
            fetch('https://a.klaviyo.com/client/subscriptions/?company_id=RgDcVQ', options)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => Promise.reject(err));
                } else {
                    // Display the success message on successful submission
                    let customSuccessElement = form.querySelector('.custom-success');
                    if (customSuccessElement) customSuccessElement.style.display = 'block';
                }
            })
            .catch(err => {
                console.error('Error sending data to Klaviyo:', err);

                // Display the error message on error
                let customErrorElement = form.querySelector('.custom-error');
                if (customErrorElement) customErrorElement.style.display = 'block';
            });
        });
    });
});

</script>
